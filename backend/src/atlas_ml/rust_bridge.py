"""Subprocess JSON bridge invoking the Rust `atlas-cli` formal argumentation solver."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel

from .schemas import ArgumentHypergraph


class GradualEvaluation(BaseModel):
    node_acceptability: dict[str, float]
    hyperedge_transmission: dict[str, float]
    iterations: int
    final_residual: float
    converged: bool


class DungSemanticsResult(BaseModel):
    grounded: list[str]
    preferred: list[list[str]]
    stable: list[list[str]]
    grounded_labels: dict[str, str]
    compiled_argument_count: int
    compiled_attack_count: int


class MinimalKnockout(BaseModel):
    removed_node_ids: list[str]
    cardinality: int
    credence_cost: float
    baseline_acceptability: float
    post_knockout_acceptability: float
    acceptability_drop: float


class SolverReport(BaseModel):
    passage_id: str
    solve_time_microseconds: int
    gradual_df_quad: GradualEvaluation
    dung_semantics: DungSemanticsResult
    thesis_id: Optional[str] = None
    minimal_knockouts: list[MinimalKnockout]


class RustBridgeError(RuntimeError):
    """Raised when `atlas-cli` fails validation or execution."""


class AtlasRustBridge:
    """Thin wrapper over the compiled `atlas-cli` Rust binary."""

    def __init__(self, repo_root: Optional[Path] = None) -> None:
        if repo_root is None:
            # backend/src/atlas_ml/rust_bridge.py -> repo root is 3 levels up from backend/src/atlas_ml
            repo_root = Path(__file__).resolve().parents[3]
        self.repo_root = Path(repo_root).resolve()

    def _command_prefix(self) -> list[str]:
        release_bin = self.repo_root / "target" / "release" / "atlas-cli"
        if release_bin.exists():
            return [str(release_bin)]
        debug_bin = self.repo_root / "target" / "debug" / "atlas-cli"
        if debug_bin.exists():
            return [str(debug_bin)]
        return ["cargo", "run", "-q", "-p", "atlas-cli", "--"]

    def solve(
        self,
        graph: ArgumentHypergraph,
        strict_spans: bool = True,
        threshold: float = 0.50,
        t_norm: Literal["godel", "product"] = "godel",
    ) -> SolverReport:
        cmd = self._command_prefix() + [
            "solve",
            "--stdin",
            "--threshold",
            str(threshold),
            "--t-norm",
            t_norm,
        ]
        if strict_spans:
            cmd.append("--strict-spans")

        payload = graph.model_dump_json()
        proc = subprocess.run(
            cmd,
            input=payload,
            text=True,
            capture_output=True,
            cwd=str(self.repo_root),
            check=False,
        )
        if proc.returncode != 0:
            raise RustBridgeError(proc.stderr.strip() or f"atlas-cli exited with {proc.returncode}")

        return SolverReport.model_validate_json(proc.stdout)

    def solve_argdown(
        self,
        argdown_text: str,
        strict_spans: bool = True,
        threshold: float = 0.50,
        t_norm: Literal["godel", "product"] = "godel",
    ) -> SolverReport:
        cmd = self._command_prefix() + [
            "solve",
            "--stdin",
            "--threshold",
            str(threshold),
            "--t-norm",
            t_norm,
        ]
        if strict_spans:
            cmd.append("--strict-spans")

        proc = subprocess.run(
            cmd,
            input=argdown_text,
            text=True,
            capture_output=True,
            cwd=str(self.repo_root),
            check=False,
        )
        if proc.returncode != 0:
            raise RustBridgeError(proc.stderr.strip() or f"atlas-cli exited with {proc.returncode}")
        return SolverReport.model_validate_json(proc.stdout)

    def load_argdown(self, argdown_path: Path) -> ArgumentHypergraph:
        cmd = self._command_prefix() + ["convert", str(argdown_path), "--to", "json"]
        proc = subprocess.run(
            cmd,
            text=True,
            capture_output=True,
            cwd=str(self.repo_root),
            check=False,
        )
        if proc.returncode != 0:
            raise RustBridgeError(proc.stderr.strip() or f"atlas-cli exited with {proc.returncode}")
        return ArgumentHypergraph.model_validate_json(proc.stdout)

    def inspect_file(self, path: Path, strict_spans: bool = True) -> SolverReport:
        cmd = self._command_prefix() + ["inspect", str(path), "--json"]
        if strict_spans:
            cmd.append("--strict-spans")
        proc = subprocess.run(
            cmd,
            text=True,
            capture_output=True,
            cwd=str(self.repo_root),
            check=False,
        )
        if proc.returncode != 0:
            raise RustBridgeError(proc.stderr.strip() or f"atlas-cli exited with {proc.returncode}")
        return SolverReport.model_validate(json.loads(proc.stdout))
