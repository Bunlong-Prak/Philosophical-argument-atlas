.PHONY: help test wasm bundle benchmark dev-api dev-web

help:
	@echo "Argument Atlas commands:"
	@echo "  make test       Run Rust, Python, and Next.js checks"
	@echo "  make wasm       Compile atlas-core to web/public/atlas_wasm.wasm"
	@echo "  make bundle     Export PhilArgs-12 + BGE vectors to web/public/corpus-bundle.json"
	@echo "  make benchmark  Run the full PhilArgs-12 ablation & alignment benchmark"
	@echo "  make dev-api    Start local FastAPI server on port 8000"
	@echo "  make dev-web    Start Next.js Workbench on port 3000"

test:
	cargo test --workspace
	cd backend && uv run pytest -v
	cd web && npm run lint && npm run build

wasm:
	cargo build --release -p atlas-wasm --target wasm32-unknown-unknown
	cp target/wasm32-unknown-unknown/release/atlas_wasm.wasm web/public/atlas_wasm.wasm

bundle:
	cargo build --release -p atlas-cli
	cd backend && uv run python scripts/export_static_bundle.py

benchmark:
	cargo build --release -p atlas-cli
	cd backend && uv run python scripts/eval_full_benchmark.py

dev-api:
	cd backend && uv run uvicorn atlas_ml.api:create_app --factory --reload --port 8000

dev-web:
	cd web && npm run dev
