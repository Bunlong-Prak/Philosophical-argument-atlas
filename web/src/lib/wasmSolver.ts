import type { ArgumentHypergraph, PassageDetail, SolverReport } from "./types";

interface AtlasWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  atlas_alloc: (len: number) => number;
  atlas_dealloc: (ptr: number, cap: number) => void;
  atlas_result_ptr: () => number;
  atlas_result_len: () => number;
  atlas_solve_json: (
    inPtr: number,
    inLen: number,
    strictSpans: number,
    threshold: number,
    useProduct: number,
  ) => number;
  atlas_parse_argdown: (
    inPtr: number,
    inLen: number,
    strictSpans: number,
    threshold: number,
    useProduct: number,
  ) => number;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

let wasmInstancePromise: Promise<AtlasWasmExports> | null = null;
let cachedExports: AtlasWasmExports | null = null;

async function instantiateAtlasWasm(): Promise<AtlasWasmExports> {
  const response = await fetch("/atlas_wasm.wasm");
  if (!response.ok) {
    throw new Error(`Failed to fetch /atlas_wasm.wasm: HTTP ${response.status}`);
  }

  let instance: WebAssembly.Instance;
  if (typeof WebAssembly.instantiateStreaming === "function") {
    try {
      const cloned = response.clone();
      const result = await WebAssembly.instantiateStreaming(cloned, {});
      instance = result.instance;
    } catch {
      const bytes = await response.arrayBuffer();
      const result = await WebAssembly.instantiate(bytes, {});
      instance = result.instance;
    }
  } else {
    const bytes = await response.arrayBuffer();
    const result = await WebAssembly.instantiate(bytes, {});
    instance = result.instance;
  }

  const exports = instance.exports as AtlasWasmExports;
  cachedExports = exports;
  return exports;
}

export function getAtlasWasm(): Promise<AtlasWasmExports> {
  if (!wasmInstancePromise) {
    wasmInstancePromise = instantiateAtlasWasm().catch((err) => {
      wasmInstancePromise = null;
      throw err;
    });
  }
  return wasmInstancePromise;
}

export function isWasmLoaded(): boolean {
  return cachedExports !== null;
}

function readResultString(exports: AtlasWasmExports): string {
  const ptr = exports.atlas_result_ptr();
  const len = exports.atlas_result_len();
  const view = new Uint8Array(exports.memory.buffer, ptr, len);
  return utf8Decoder.decode(view);
}

export async function solveGraphWasm(
  graph: ArgumentHypergraph,
  options: {
    strictSpans?: boolean;
    threshold?: number;
    tNorm?: "godel" | "product";
  } = {},
): Promise<SolverReport> {
  const exports = cachedExports ?? (await getAtlasWasm());
  const payloadBytes = utf8Encoder.encode(JSON.stringify(graph));
  const strictFlag = (options.strictSpans ?? Boolean(graph.source_text)) ? 1 : 0;
  const threshold = options.threshold ?? 0.5;
  const prodFlag = options.tNorm === "product" ? 1 : 0;

  const t0 = performance.now();
  const inPtr = exports.atlas_alloc(payloadBytes.byteLength);
  let rc = 1;
  try {
    new Uint8Array(exports.memory.buffer, inPtr, payloadBytes.byteLength).set(payloadBytes);
    rc = exports.atlas_solve_json(
      inPtr,
      payloadBytes.byteLength,
      strictFlag,
      threshold,
      prodFlag,
    );
  } finally {
    exports.atlas_dealloc(inPtr, payloadBytes.byteLength);
  }
  const elapsedUs = Math.max(1, Math.round((performance.now() - t0) * 1000));
  const resultText = readResultString(exports);

  if (rc !== 0) {
    throw new Error(resultText || "Wasm solver error");
  }
  const report = JSON.parse(resultText) as SolverReport;
  report.solve_time_microseconds = elapsedUs;
  return report;
}

export async function parseArgdownWasm(
  argdown: string,
  options: {
    strictSpans?: boolean;
    threshold?: number;
    tNorm?: "godel" | "product";
  } = {},
): Promise<PassageDetail> {
  const exports = cachedExports ?? (await getAtlasWasm());
  const payloadBytes = utf8Encoder.encode(argdown);
  const strictFlag = (options.strictSpans ?? true) ? 1 : 0;
  const threshold = options.threshold ?? 0.5;
  const prodFlag = options.tNorm === "product" ? 1 : 0;

  const t0 = performance.now();
  const inPtr = exports.atlas_alloc(payloadBytes.byteLength);
  let rc = 1;
  try {
    new Uint8Array(exports.memory.buffer, inPtr, payloadBytes.byteLength).set(payloadBytes);
    rc = exports.atlas_parse_argdown(
      inPtr,
      payloadBytes.byteLength,
      strictFlag,
      threshold,
      prodFlag,
    );
  } finally {
    exports.atlas_dealloc(inPtr, payloadBytes.byteLength);
  }
  const elapsedUs = Math.max(1, Math.round((performance.now() - t0) * 1000));
  const resultText = readResultString(exports);

  if (rc !== 0) {
    throw new Error(resultText || "Wasm .argdown parse error");
  }
  const detail = JSON.parse(resultText) as PassageDetail;
  detail.report.solve_time_microseconds = elapsedUs;
  return detail;
}
