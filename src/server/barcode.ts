import "server-only";

import bwipjs from "bwip-js/node";

/** Code 128 barcode as an SVG string (labels, waybills). Bars only; the text is printed separately. */
export function code128Svg(text: string): string {
  return bwipjs.toSVG({ bcid: "code128", text, scale: 2, height: 8, includetext: false, paddingwidth: 0, paddingheight: 0 });
}
