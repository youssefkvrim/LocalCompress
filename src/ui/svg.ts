/**
 * SVG pictures, for conversion and background removal.
 *
 * Workers have no DOM and cannot decode SVG, so the picture is drawn here,
 * on the page, through an <img>: in that context an SVG can neither run a
 * script nor load anything (fonts, images, links are not fetched). The
 * worker then receives a PNG of it. No engine code is involved.
 */

/** Longest edge of the PNG: vectors are drawn sharp, at least this size, at most MAX_EDGE. */
const MIN_EDGE = 2048;
const MAX_EDGE = 4096;

export const isSvg = (file: File) => file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);

export async function rasterizeSvg(file: File): Promise<File> {
  const url = URL.createObjectURL(file.type === 'image/svg+xml' ? file : new Blob([file], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // No width / height in the file: the browser cannot size it, use a square.
    const w = img.naturalWidth || MIN_EDGE;
    const h = img.naturalHeight || MIN_EDGE;
    const scale = Math.min(MAX_EDGE / Math.max(w, h), Math.max(1, MIN_EDGE / Math.max(w, h)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    canvas.width = canvas.height = 0;
    if (!png) throw new Error('SVG could not be drawn');
    // Same name: the result is named after the original (logo.svg → logo.png).
    return new File([png], file.name, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
