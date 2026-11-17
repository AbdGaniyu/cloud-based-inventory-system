import "server-only";

import path from "node:path";

import { Font } from "@react-pdf/renderer";

/**
 * Inter and JetBrains Mono (SIL OFL, files in ./fonts) so documents match the app and can print
 * the ₦ sign — the built-in PDF fonts (Helvetica, Courier) have no Naira glyph.
 */
export const PDF_SANS = "Inter";
export const PDF_MONO = "JetBrains Mono";

const FONT_DIR = path.join(process.cwd(), "src/server/pdf/fonts");
let registered = false;

export function registerPdfFonts(): void {
  if (registered) return;
  Font.register({
    family: PDF_SANS,
    fonts: [
      { src: path.join(FONT_DIR, "Inter-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "Inter-Medium.ttf"), fontWeight: 500 },
      { src: path.join(FONT_DIR, "Inter-SemiBold.ttf"), fontWeight: 600 },
      { src: path.join(FONT_DIR, "Inter-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.register({ family: PDF_MONO, src: path.join(FONT_DIR, "JetBrainsMono-Regular.ttf") });
  // Never hyphenate names, IMEIs or amounts.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
