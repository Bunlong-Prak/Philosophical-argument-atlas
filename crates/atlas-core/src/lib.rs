pub mod argdown;
pub mod dung;
pub mod gradual;
pub mod knockout;
pub mod model;

#[cfg(test)]
mod tests {
    use crate::argdown::{parse_argdown, to_argdown};
    use crate::dung::{solve_hypergraph_dung, DungFramework, Label};
    use crate::gradual::{
        df_quad_combine, solve_df_quad, ConjunctiveNorm, GradualSolverConfig,
    };
    use crate::knockout::{find_minimal_knockouts, KnockoutConfig};
    use crate::model::{
        ArgumentHypergraph, ArgumentationScheme, HypergraphError, NodeType, PropositionNode,
        RebuttingAttack, SupportHyperedge, TextSpan, UndercuttingAttack,
    };
    use std::collections::BTreeSet;

    #[test]
    fn test_strict_span_verification_catches_hallucinated_quotes() {
        let source = "I think, therefore I am.";
        let bad_graph = ArgumentHypergraph {
            passage_id: "descartes-cogito".to_string(),
            source_text: Some(source.to_string()),
            nodes: vec![PropositionNode {
                id: "p1".to_string(),
                proposition: "The subject is thinking.".to_string(),
                node_type: NodeType::ExplicitPremise,
                span: Some(TextSpan {
                    start_char: 0,
                    end_char: 7,
                    verbatim_quote: "I doubt".to_string(), // Hallucinated quote! Actual is "I think"
                }),
                speaker: Some("Descartes".to_string()),
                base_credence: 0.9,
            }],
            support_hyperedges: vec![],
            rebutting_attacks: vec![],
            undercutting_attacks: vec![],
        };

        let err = bad_graph.validate(true).unwrap_err();
        assert_eq!(
            err,
            HypergraphError::SpanQuoteMismatch {
                node_id: "p1".to_string(),
                expected: "I doubt".to_string(),
                actual: "I think".to_string(),
            }
        );
    }

    #[test]
    fn test_linked_conjunctive_hyperedge_vs_enthymeme_collapse() {
        // Descartes' Cogito:
        // Explicit Premise P1: "I think" (base_credence = 1.0)
        // Implicit Enthymeme E1: "Whatever thinks must exist" (initially 0.9, then knocked out to 0.0)
        // Thesis C: "I exist" (intrinsic base_credence = 0.5 prior to argument support)
        let mut graph = ArgumentHypergraph {
            passage_id: "descartes-cogito".to_string(),
            source_text: Some("I think, therefore I am.".to_string()),
            nodes: vec![
                PropositionNode {
                    id: "P1".to_string(),
                    proposition: "I am currently thinking.".to_string(),
                    node_type: NodeType::ExplicitPremise,
                    span: Some(TextSpan {
                        start_char: 0,
                        end_char: 7,
                        verbatim_quote: "I think".to_string(),
                    }),
                    speaker: Some("Descartes".to_string()),
                    base_credence: 1.0,
                },
                PropositionNode {
                    id: "E1".to_string(),
                    proposition: "Whatever is thinking must exist while it thinks.".to_string(),
                    node_type: NodeType::Enthymeme,
                    span: None,
                    speaker: Some("Descartes (Implicit)".to_string()),
                    base_credence: 0.9,
                },
                PropositionNode {
                    id: "C".to_string(),
                    proposition: "Therefore, I exist.".to_string(),
                    node_type: NodeType::Thesis,
                    span: Some(TextSpan {
                        start_char: 19,
                        end_char: 23,
                        verbatim_quote: "I am".to_string(),
                    }),
                    speaker: Some("Descartes".to_string()),
                    base_credence: 0.5,
                },
            ],
            support_hyperedges: vec![SupportHyperedge {
                id: "H1".to_string(),
                premises: vec!["P1".to_string(), "E1".to_string()],
                conclusion: "C".to_string(),
                weight: 1.0,
                scheme: Some(ArgumentationScheme::ModusPonens),
            }],
            rebutting_attacks: vec![],
            undercutting_attacks: vec![],
        };

        graph.validate(true).expect("Valid Cogito graph");
        let cfg = GradualSolverConfig::default();

        // 1. With E1 = 0.9, H1 transmits min(1.0, 0.9) = 0.9 -> C rises from 0.5 to 0.5 + 0.5*0.9 = 0.95
        let eval_with_enthymeme = solve_df_quad(&graph, &cfg).unwrap();
        assert!(eval_with_enthymeme.converged);
        let c_score_high = eval_with_enthymeme.node_acceptability["C"];
        assert!((c_score_high - 0.95).abs() < 1e-6);

        // 2. Reject the unspoken assumption E1 (base_credence = 0.0, e.g., Lichtenberg's objection:
        //    "It thinks, just as one says 'it lightnings'—no 'I' is entailed").
        //    Because P1 and E1 are LINKED in a conjunctive hyperedge, rejecting E1 collapses H1 to 0.0!
        graph.nodes[1].base_credence = 0.0;
        let eval_without_enthymeme = solve_df_quad(&graph, &cfg).unwrap();
        let h1_trans = eval_without_enthymeme.hyperedge_transmission["H1"];
        let c_score_collapsed = eval_without_enthymeme.node_acceptability["C"];
        assert!((h1_trans - 0.0).abs() < 1e-6);
        assert!((c_score_collapsed - 0.5).abs() < 1e-6);
    }

    #[test]
    fn test_pollock_undercutting_defeater_severs_inference_without_rebutting_claim() {
        // Pollock's classic epistemic example:
        // P1: "The object looks red to me." (1.0)
        // H1: P1 -> C ("The object is red", base = 0.5, warrant = 0.8)
        // U1 (Undercutter): "The object is illuminated by a trick red light." (1.0)
        // Notice U1 does NOT prove the object isn't red (rebuttal); it severs the inference H1!
        let graph = ArgumentHypergraph {
            passage_id: "pollock-red-light".to_string(),
            source_text: None,
            nodes: vec![
                PropositionNode {
                    id: "P1".to_string(),
                    proposition: "The object looks red.".to_string(),
                    node_type: NodeType::ExplicitPremise,
                    span: None,
                    speaker: None,
                    base_credence: 1.0,
                },
                PropositionNode {
                    id: "C".to_string(),
                    proposition: "The object is actually red.".to_string(),
                    node_type: NodeType::Thesis,
                    span: None,
                    speaker: None,
                    base_credence: 0.5,
                },
                PropositionNode {
                    id: "U1".to_string(),
                    proposition: "The object is illuminated by a red spotlight.".to_string(),
                    node_type: NodeType::Objection,
                    span: None,
                    speaker: None,
                    base_credence: 1.0,
                },
            ],
            support_hyperedges: vec![SupportHyperedge {
                id: "H1".to_string(),
                premises: vec!["P1".to_string()],
                conclusion: "C".to_string(),
                weight: 0.8,
                scheme: Some(ArgumentationScheme::SignOrEvidence),
            }],
            rebutting_attacks: vec![],
            undercutting_attacks: vec![UndercuttingAttack {
                id: "UND1".to_string(),
                attacker: "U1".to_string(),
                target_hyperedge: "H1".to_string(),
                weight: 1.0,
            }],
        };

        let eval = solve_df_quad(&graph, &GradualSolverConfig::default()).unwrap();
        // Because U1 undercuts H1 completely, H1 transmits 0.0, so C falls back to its prior (0.5),
        // NOT to 0.0 (which a rebuttal would have caused!).
        assert!((eval.hyperedge_transmission["H1"] - 0.0).abs() < 1e-6);
        assert!((eval.node_acceptability["C"] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn test_cyclic_mutual_rebuttal_convergence_with_vs_without_damping() {
        // Kant's Third Antinomy of Pure Reason (Thesis vs. Antithesis mutual attack cycle):
        // A ("Causality through freedom is necessary") <-> B ("Everything happens solely by laws of nature")
        let antinomy = ArgumentHypergraph {
            passage_id: "kant-third-antinomy".to_string(),
            source_text: None,
            nodes: vec![
                PropositionNode {
                    id: "Thesis".to_string(),
                    proposition: "Causality according to laws of nature is not the only one; freedom is necessary.".to_string(),
                    node_type: NodeType::Thesis,
                    span: None,
                    speaker: Some("Kant (Dogmatic Thesis)".to_string()),
                    base_credence: 0.8,
                },
                PropositionNode {
                    id: "Antithesis".to_string(),
                    proposition: "There is no freedom; everything in the world happens solely according to laws of nature.".to_string(),
                    node_type: NodeType::Objection,
                    span: None,
                    speaker: Some("Kant (Empiricist Antithesis)".to_string()),
                    base_credence: 0.8,
                },
            ],
            support_hyperedges: vec![],
            rebutting_attacks: vec![
                RebuttingAttack {
                    id: "R1".to_string(),
                    attacker: "Thesis".to_string(),
                    target: "Antithesis".to_string(),
                    weight: 1.0,
                },
                RebuttingAttack {
                    id: "R2".to_string(),
                    attacker: "Antithesis".to_string(),
                    target: "Thesis".to_string(),
                    weight: 1.0,
                },
            ],
            undercutting_attacks: vec![],
        };

        let eval = solve_df_quad(&antinomy, &GradualSolverConfig::default()).unwrap();
        assert!(eval.converged);
        // Analytical fixed point of symmetric mutual attack:
        // s* = v0 * (1 - s*) => s* (1 + v0) = v0 => s* = v0 / (1 + v0) = 0.8 / 1.8 = 4/9 ≈ 0.4444444
        let expected = 0.8 / 1.8;
        assert!((eval.node_acceptability["Thesis"] - expected).abs() < 1e-6);
        assert!((eval.node_acceptability["Antithesis"] - expected).abs() < 1e-6);
        assert!((df_quad_combine(0.8, expected, 0.0) - expected).abs() < 1e-15);

        // Compare GodelMinimum vs Product T-norm on linked premises (0.8, 0.5):
        let mut conj_graph = ArgumentHypergraph {
            passage_id: "tnorm-comparison".to_string(),
            source_text: None,
            nodes: vec![
                PropositionNode {
                    id: "P1".to_string(),
                    proposition: "Premise 1".to_string(),
                    node_type: NodeType::ExplicitPremise,
                    span: None,
                    speaker: None,
                    base_credence: 0.8,
                },
                PropositionNode {
                    id: "P2".to_string(),
                    proposition: "Premise 2".to_string(),
                    node_type: NodeType::ExplicitPremise,
                    span: None,
                    speaker: None,
                    base_credence: 0.5,
                },
                PropositionNode {
                    id: "C".to_string(),
                    proposition: "Conclusion".to_string(),
                    node_type: NodeType::Thesis,
                    span: None,
                    speaker: None,
                    base_credence: 0.2,
                },
            ],
            support_hyperedges: vec![SupportHyperedge {
                id: "H1".to_string(),
                premises: vec!["P1".to_string(), "P2".to_string()],
                conclusion: "C".to_string(),
                weight: 1.0,
                scheme: None,
            }],
            rebutting_attacks: vec![],
            undercutting_attacks: vec![],
        };

        let eval_godel = solve_df_quad(
            &conj_graph,
            &GradualSolverConfig {
                t_norm: ConjunctiveNorm::GodelMinimum,
                ..Default::default()
            },
        )
        .unwrap();
        let eval_product = solve_df_quad(
            &mut conj_graph,
            &GradualSolverConfig {
                t_norm: ConjunctiveNorm::Product,
                ..Default::default()
            },
        )
        .unwrap();
        // Godel: min(0.8, 0.5) = 0.50; Product: 0.8 * 0.5 = 0.40
        assert!((eval_godel.hyperedge_transmission["H1"] - 0.50).abs() < 1e-6);
        assert!((eval_product.hyperedge_transmission["H1"] - 0.40).abs() < 1e-6);
    }

    #[test]
    fn test_dung_nixon_diamond_and_reinstatement() {
        // (a) Reinstatement chain: A -> B -> C
        let chain = DungFramework {
            arguments: vec!["A".into(), "B".into(), "C".into()],
            attacks: vec![("A".into(), "B".into()), ("B".into(), "C".into())],
        };
        let expected_ac: BTreeSet<String> = ["A".into(), "C".into()].into_iter().collect();
        assert_eq!(chain.compute_grounded_extension(), expected_ac);
        assert_eq!(chain.compute_preferred_extensions(), vec![expected_ac.clone()]);
        assert_eq!(chain.compute_stable_extensions(), vec![expected_ac]);

        // (b) Nixon Diamond: A <-> B
        let nixon = DungFramework {
            arguments: vec!["A".into(), "B".into()],
            attacks: vec![("A".into(), "B".into()), ("B".into(), "A".into())],
        };
        assert!(nixon.compute_grounded_extension().is_empty());
        let set_a: BTreeSet<String> = ["A".into()].into_iter().collect();
        let set_b: BTreeSet<String> = ["B".into()].into_iter().collect();
        assert_eq!(
            nixon.compute_preferred_extensions(),
            vec![set_a.clone(), set_b.clone()]
        );
        assert_eq!(nixon.compute_stable_extensions(), vec![set_a, set_b]);

        // (c) Odd 3-cycle: A -> B -> C -> A (preferred is empty, zero stable extensions)
        let odd_cycle = DungFramework {
            arguments: vec!["A".into(), "B".into(), "C".into()],
            attacks: vec![
                ("A".into(), "B".into()),
                ("B".into(), "C".into()),
                ("C".into(), "A".into()),
            ],
        };
        assert!(odd_cycle.compute_grounded_extension().is_empty());
        assert_eq!(odd_cycle.compute_preferred_extensions(), vec![BTreeSet::new()]);
        assert!(odd_cycle.compute_stable_extensions().is_empty());
    }

    #[test]
    fn test_hypergraph_dung_reinstatement_against_undercutter() {
        // Multi-hop chain P1 -> M1 -> C where U1 undercuts H1 (P1 -> M1),
        // testing transitive defeat propagation and reinstatement by defender D1.
        let mut graph = ArgumentHypergraph {
            passage_id: "undercutter-reinstatement".to_string(),
            source_text: None,
            nodes: vec![
                PropositionNode {
                    id: "P1".to_string(),
                    proposition: "Initial premise".to_string(),
                    node_type: NodeType::ExplicitPremise,
                    span: None,
                    speaker: None,
                    base_credence: 1.0,
                },
                PropositionNode {
                    id: "M1".to_string(),
                    proposition: "Intermediate derived claim".to_string(),
                    node_type: NodeType::ExplicitPremise,
                    span: None,
                    speaker: None,
                    base_credence: 0.3,
                },
                PropositionNode {
                    id: "C".to_string(),
                    proposition: "Main thesis".to_string(),
                    node_type: NodeType::Thesis,
                    span: None,
                    speaker: None,
                    base_credence: 0.3,
                },
                PropositionNode {
                    id: "U1".to_string(),
                    proposition: "Undercutter severing H1".to_string(),
                    node_type: NodeType::Objection,
                    span: None,
                    speaker: None,
                    base_credence: 1.0,
                },
            ],
            support_hyperedges: vec![
                SupportHyperedge {
                    id: "H1".to_string(),
                    premises: vec!["P1".to_string()],
                    conclusion: "M1".to_string(),
                    weight: 1.0,
                    scheme: Some(ArgumentationScheme::ModusPonens),
                },
                SupportHyperedge {
                    id: "H2".to_string(),
                    premises: vec!["M1".to_string()],
                    conclusion: "C".to_string(),
                    weight: 1.0,
                    scheme: Some(ArgumentationScheme::ModusPonens),
                },
            ],
            rebutting_attacks: vec![],
            undercutting_attacks: vec![UndercuttingAttack {
                id: "UND1".to_string(),
                attacker: "U1".to_string(),
                target_hyperedge: "H1".to_string(),
                weight: 1.0,
            }],
        };

        // 1. Without defender D1: U1 undercuts H1, defeating M1 and transitively defeating C.
        let res_undercut = solve_hypergraph_dung(&graph).unwrap();
        assert!(!res_undercut.grounded.contains("C"));
        assert!(!res_undercut.grounded.contains("M1"));
        assert_eq!(res_undercut.grounded_labels["M1"], Label::Out);
        assert_eq!(res_undercut.grounded_labels["C"], Label::Out);
        assert_eq!(res_undercut.grounded_labels["U1"], Label::In);

        // 2. Add defender D1 rebutting U1 -> M1 and C are reinstated into Grounded extension!
        graph.nodes.push(PropositionNode {
            id: "D1".to_string(),
            proposition: "Counter-rebuttal defeating U1".to_string(),
            node_type: NodeType::ExplicitPremise,
            span: None,
            speaker: None,
            base_credence: 1.0,
        });
        graph.rebutting_attacks.push(RebuttingAttack {
            id: "R1".to_string(),
            attacker: "D1".to_string(),
            target: "U1".to_string(),
            weight: 1.0,
        });

        let res_reinstated = solve_hypergraph_dung(&graph).unwrap();
        assert!(res_reinstated.grounded.contains("P1"));
        assert!(res_reinstated.grounded.contains("D1"));
        assert!(res_reinstated.grounded.contains("M1"));
        assert!(res_reinstated.grounded.contains("C"));
        assert_eq!(res_reinstated.grounded_labels["U1"], Label::Out);
        assert_eq!(res_reinstated.grounded_labels["C"], Label::In);
    }

    #[test]
    fn test_minimal_knockout_prefers_weak_enthymeme_and_handles_convergent_branches() {
        // Part A: Single Linked Hyperedge {P1 (1.0), E1 (0.7)} -> C (0.4)
        let single_branch = ArgumentHypergraph {
            passage_id: "single-branch-ko".to_string(),
            source_text: None,
            nodes: vec![
                PropositionNode {
                    id: "P1".to_string(),
                    proposition: "Strong explicit premise".to_string(),
                    node_type: NodeType::ExplicitPremise,
                    span: None,
                    speaker: None,
                    base_credence: 1.0,
                },
                PropositionNode {
                    id: "E1".to_string(),
                    proposition: "Plausible unspoken enthymeme".to_string(),
                    node_type: NodeType::Enthymeme,
                    span: None,
                    speaker: None,
                    base_credence: 0.7,
                },
                PropositionNode {
                    id: "C".to_string(),
                    proposition: "Thesis".to_string(),
                    node_type: NodeType::Thesis,
                    span: None,
                    speaker: None,
                    base_credence: 0.4,
                },
            ],
            support_hyperedges: vec![SupportHyperedge {
                id: "H1".to_string(),
                premises: vec!["P1".to_string(), "E1".to_string()],
                conclusion: "C".to_string(),
                weight: 1.0,
                scheme: None,
            }],
            rebutting_attacks: vec![],
            undercutting_attacks: vec![],
        };

        let kos_a = find_minimal_knockouts(&single_branch, &KnockoutConfig::for_target("C")).unwrap();
        // Both {E1} and {P1} are minimal size-1 knockouts; {P1, E1} must be pruned!
        assert_eq!(kos_a.len(), 2);
        assert_eq!(kos_a[0].removed_node_ids, vec!["E1".to_string()]);
        assert!((kos_a[0].credence_cost - 0.7).abs() < 1e-6);
        assert_eq!(kos_a[1].removed_node_ids, vec!["P1".to_string()]);
        assert!((kos_a[1].credence_cost - 1.0).abs() < 1e-6);

        // Part B: Two Convergent Branches H1:{P1(1.0), E1(0.6)} -> C(0.3) and H2:{P2(0.9), E2(0.5)} -> C(0.3)
        let convergent = ArgumentHypergraph {
            passage_id: "convergent-ko".to_string(),
            source_text: None,
            nodes: vec![
                PropositionNode {
                    id: "P1".to_string(),
                    proposition: "Explicit premise 1".to_string(),
                    node_type: NodeType::ExplicitPremise,
                    span: None,
                    speaker: None,
                    base_credence: 1.0,
                },
                PropositionNode {
                    id: "E1".to_string(),
                    proposition: "Enthymeme 1".to_string(),
                    node_type: NodeType::Enthymeme,
                    span: None,
                    speaker: None,
                    base_credence: 0.6,
                },
                PropositionNode {
                    id: "P2".to_string(),
                    proposition: "Explicit premise 2".to_string(),
                    node_type: NodeType::ExplicitPremise,
                    span: None,
                    speaker: None,
                    base_credence: 0.9,
                },
                PropositionNode {
                    id: "E2".to_string(),
                    proposition: "Enthymeme 2".to_string(),
                    node_type: NodeType::Enthymeme,
                    span: None,
                    speaker: None,
                    base_credence: 0.5,
                },
                PropositionNode {
                    id: "C".to_string(),
                    proposition: "Thesis".to_string(),
                    node_type: NodeType::Thesis,
                    span: None,
                    speaker: None,
                    base_credence: 0.3,
                },
            ],
            support_hyperedges: vec![
                SupportHyperedge {
                    id: "H1".to_string(),
                    premises: vec!["P1".to_string(), "E1".to_string()],
                    conclusion: "C".to_string(),
                    weight: 1.0,
                    scheme: None,
                },
                SupportHyperedge {
                    id: "H2".to_string(),
                    premises: vec!["P2".to_string(), "E2".to_string()],
                    conclusion: "C".to_string(),
                    weight: 1.0,
                    scheme: None,
                },
            ],
            rebutting_attacks: vec![],
            undercutting_attacks: vec![],
        };

        let kos_b = find_minimal_knockouts(&convergent, &KnockoutConfig::for_target("C")).unwrap();
        // No size-1 knockout collapses C; 4 cross-branch size-2 knockouts collapse C to 0.30.
        assert_eq!(kos_b.len(), 4);
        assert!(kos_b.iter().all(|k| k.cardinality == 2));
        // Lowest epistemic cost knockout is {E1, E2} with cost 0.6 + 0.5 = 1.1.
        assert_eq!(
            kos_b[0].removed_node_ids,
            vec!["E1".to_string(), "E2".to_string()]
        );
        assert!((kos_b[0].credence_cost - 1.1).abs() < 1e-6);
        assert!((kos_b[0].post_knockout_acceptability - 0.3).abs() < 1e-6);
    }

    #[test]
    fn test_argdown_lossless_roundtrip_and_solving() {
        let source = "I think, therefore I am. Yet it thinks does not entail a substantial ego.";
        let original = ArgumentHypergraph {
            passage_id: "descartes-vs-lichtenberg".to_string(),
            source_text: Some(source.to_string()),
            nodes: vec![
                PropositionNode {
                    id: "P1".to_string(),
                    proposition: "There is thinking occurring now.".to_string(),
                    node_type: NodeType::ExplicitPremise,
                    span: Some(TextSpan {
                        start_char: 0,
                        end_char: 7,
                        verbatim_quote: "I think".to_string(),
                    }),
                    speaker: Some("Descartes".to_string()),
                    base_credence: 1.0,
                },
                PropositionNode {
                    id: "E1".to_string(),
                    proposition: "Thinking requires a persistent substantial ego.".to_string(),
                    node_type: NodeType::Enthymeme,
                    span: None,
                    speaker: Some("Descartes (Implicit)".to_string()),
                    base_credence: 0.75,
                },
                PropositionNode {
                    id: "C".to_string(),
                    proposition: "I exist as a thinking substance.".to_string(),
                    node_type: NodeType::Thesis,
                    span: Some(TextSpan {
                        start_char: 19,
                        end_char: 23,
                        verbatim_quote: "I am".to_string(),
                    }),
                    speaker: Some("Descartes".to_string()),
                    base_credence: 0.4,
                },
                PropositionNode {
                    id: "U1".to_string(),
                    proposition: "Immediate experience only warrants saying 'it thinks', not a substantial 'I'.".to_string(),
                    node_type: NodeType::Objection,
                    span: Some(TextSpan {
                        start_char: 29,
                        end_char: 72,
                        verbatim_quote: "it thinks does not entail a substantial ego".to_string(),
                    }),
                    speaker: Some("Lichtenberg".to_string()),
                    base_credence: 0.85,
                },
            ],
            support_hyperedges: vec![SupportHyperedge {
                id: "H1".to_string(),
                premises: vec!["P1".to_string(), "E1".to_string()],
                conclusion: "C".to_string(),
                weight: 0.95,
                scheme: Some(ArgumentationScheme::ModusPonens),
            }],
            rebutting_attacks: vec![],
            undercutting_attacks: vec![UndercuttingAttack {
                id: "UND1".to_string(),
                attacker: "U1".to_string(),
                target_hyperedge: "H1".to_string(),
                weight: 0.8,
            }],
        };

        original.validate(true).expect("Original graph valid");
        let argdown_text = to_argdown(&original);
        let parsed = parse_argdown(&argdown_text).expect("Parsed Argdown valid");
        parsed.validate(true).expect("Round-tripped graph passes strict span verification");

        let eval1 = solve_df_quad(&original, &GradualSolverConfig::default()).unwrap();
        let eval2 = solve_df_quad(&parsed, &GradualSolverConfig::default()).unwrap();
        for node in &original.nodes {
            assert!(
                (eval1.node_acceptability[&node.id] - eval2.node_acceptability[&node.id]).abs()
                    < 1e-9
            );
        }
    }
}
