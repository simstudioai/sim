import { MAX_SANDBOX_IMAGE_DATA_URI_CHARS } from '@/lib/execution/isolated-vm-limits'
import { workspaceFileBroker } from '@/lib/execution/sandbox/brokers/workspace-file'
import { defineSandboxTask } from '@/lib/execution/sandbox/define-task'
import type { SandboxTaskInput } from '@/lib/execution/sandbox/types'

export const pdfGenerateTask = defineSandboxTask<SandboxTaskInput>({
  id: 'pdf-generate',
  timeoutMs: 60_000,
  bundles: ['pdf-lib'],
  brokers: [workspaceFileBroker],
  bootstrap: `
    const PDFLib = globalThis.__bundles['pdf-lib'];
    if (!PDFLib) throw new Error('pdf-lib bundle not loaded');
    globalThis.PDFLib = PDFLib;
    globalThis.pdf = await PDFLib.PDFDocument.create();

    // Convenience shortcuts — avoids verbose PDFLib.rgb() / PDFLib.StandardFonts.Helvetica
    globalThis.rgb           = PDFLib.rgb;
    globalThis.StandardFonts = PDFLib.StandardFonts;

    /**
     * hex('#1E2761') — a pdf-lib color from a CSS-style hex string. pdf-lib's
     * rgb() takes 0–1 floats, which models habitually feed 0–255 or hex; this
     * is the safe entry point. Accepts with or without '#'.
     */
    globalThis.hex = function hex(h) {
      const s = String(h).replace(/^#/, '');
      if (!/^[0-9a-fA-F]{6}$/.test(s)) throw new Error('hex: expected a 6-digit hex color, got ' + h);
      return PDFLib.rgb(
        parseInt(s.slice(0, 2), 16) / 255,
        parseInt(s.slice(2, 4), 16) / 255,
        parseInt(s.slice(4, 6), 16) / 255
      );
    };

    /**
     * wrapText(font, text, size, maxWidth) — measured line-wrapping. Returns an
     * array of lines whose rendered width fits maxWidth (points). Words longer
     * than maxWidth land on their own line rather than looping forever.
     */
    globalThis.wrapText = function wrapText(font, text, size, maxWidth) {
      if (!font || typeof font.widthOfTextAtSize !== 'function') {
        throw new Error('wrapText: pass an embedded font (await pdf.embedFont(StandardFonts.Helvetica))');
      }
      const lines = [];
      for (const paragraph of String(text).split('\\n')) {
        const words = paragraph.split(/\\s+/).filter(Boolean);
        if (words.length === 0) { lines.push(''); continue; }
        let line = words[0];
        for (let i = 1; i < words.length; i++) {
          const candidate = line + ' ' + words[i];
          if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
          else { lines.push(line); line = words[i]; }
        }
        lines.push(line);
      }
      return lines;
    };

    /**
     * drawWrappedText(page, text, opts) — wrap and draw in one call. Required
     * opts: x, y (top baseline), font, size, maxWidth. Optional: lineHeight
     * (default size * 1.3), color. Returns the y coordinate BELOW the block so
     * flowing layouts can continue from it.
     */
    globalThis.drawWrappedText = function drawWrappedText(page, text, opts) {
      if (!opts || opts.x == null || opts.y == null || !opts.font || !opts.size || !opts.maxWidth) {
        throw new Error('drawWrappedText: opts must include x, y, font, size, and maxWidth');
      }
      const lineHeight = opts.lineHeight || opts.size * 1.3;
      let y = opts.y;
      for (const line of globalThis.wrapText(opts.font, text, opts.size, opts.maxWidth)) {
        page.drawText(line, { x: opts.x, y, size: opts.size, font: opts.font, color: opts.color });
        y -= lineHeight;
      }
      return y;
    };

    // Page-size constants in points (1pt = 1/72 inch)
    globalThis.LETTER = [612, 792];        // 8.5" × 11"
    globalThis.A4     = [595.28, 841.89];  // 210mm × 297mm

    // 6 MB raw ≈ 8 MB base64; reject above this to avoid sandbox OOM.
    const _MAX_IMG_B64 = ${MAX_SANDBOX_IMAGE_DATA_URI_CHARS};

    /**
     * embedImage(dataUri) — embed a data-URI image into the active PDF document.
     * Dispatches to embedPng or embedJpg based on MIME type.
     */
    globalThis.embedImage = async function embedImage(dataUri) {
      if (!dataUri || typeof dataUri !== 'string') {
        throw new Error('embedImage: dataUri must be a non-empty string');
      }
      const comma = dataUri.indexOf(',');
      if (comma === -1) throw new Error('embedImage: invalid data URI (no comma separator)');
      const header = dataUri.slice(0, comma);
      const base64 = dataUri.slice(comma + 1);
      if (!globalThis.Buffer) throw new Error('embedImage: Buffer polyfill missing');
      const binary = globalThis.Buffer.from(base64, 'base64');
      const mime = header.split(';')[0].split(':')[1] || '';
      // image/jpg is non-standard but tolerated; the canonical MIME is image/jpeg
      if (mime === 'image/png') return globalThis.pdf.embedPng(binary);
      if (mime === 'image/jpeg' || mime === 'image/jpg') return globalThis.pdf.embedJpg(binary);
      throw new Error('embedImage: only PNG and JPEG are supported (got ' + (mime || 'unknown — check data URI header') + ')');
    };

    /**
     * getFileBase64(fileId) — load a workspace file as a data URI string.
     */
    globalThis.getFileBase64 = async function getFileBase64(fileId) {
      if (!fileId || typeof fileId !== 'string') {
        throw new Error('getFileBase64: fileId must be a non-empty string');
      }
      const res = await globalThis.__brokers.workspaceFile({ fileId });
      if (!res || !res.dataUri) {
        throw new Error('getFileBase64: broker returned no data for file ' + fileId);
      }
      if (res.dataUri.length > _MAX_IMG_B64) {
        throw new Error(
          'getFileBase64: image exceeds the 6 MB embed limit (~8 MB base64). Use a smaller/compressed image.'
        );
      }
      return res.dataUri;
    };

    /**
     * drawImage(page, fileId, opts) — fetch a workspace file and draw it on the given page.
     * Required opts: x, y, width, height (points).
     * Example: await drawImage(page, 'abc123', { x: 50, y: 700, width: 200, height: 100 });
     */
    globalThis.drawImage = async function drawImage(page, fileId, opts) {
      if (!opts || opts.x == null || opts.y == null || opts.width == null || opts.height == null) {
        throw new Error('drawImage: opts must include x, y, width, and height (in points)');
      }
      const dataUri = await globalThis.getFileBase64(fileId);
      const img = await globalThis.embedImage(dataUri);
      page.drawImage(img, opts);
    };
  `,
  finalize: `
    const pdf = globalThis.pdf;
    if (!pdf) {
      throw new Error('No PDF document. Use the injected pdf object or load one with PDFLib.PDFDocument.load().');
    }
    const bytes = await pdf.save();
    return bytes;
  `,
  toResult: (bytes) => Buffer.from(bytes),
})
