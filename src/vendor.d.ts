/** pdf.js ships its worker without type declarations; only this export is used (fake worker in pdfimages.ts). */
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
