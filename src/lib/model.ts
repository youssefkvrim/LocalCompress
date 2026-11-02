/**
 * The background-removal model and ONNX Runtime's WebAssembly, as URLs of
 * application files. Only strings: the page imports this to download them in
 * the background (ui/preload.ts), the worker to run them (engines/removebg.ts).
 *
 * IS-Net "general use" (Apache-2.0), ONNX export from rembg.
 */
import ortWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';

export const modelUrl = '/models/isnet-general-use.onnx';
export { ortWasmUrl };
export const MODEL_NAME = 'IS-Net';
/** Approximate download size, shown to the user. */
export const MODEL_MB = 180;
