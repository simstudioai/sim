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

    // Page-size constants in points (1pt = 1/72 inch)
    globalThis.LETTER = [612, 792];        // 8.5" × 11"
    globalThis.A4     = [595.28, 841.89];  // 210mm × 297mm

    // 6 MB raw ≈ 8 MB base64; reject above this to avoid sandbox OOM.
    const _MAX_IMG_B64 = 8 * 1024 * 1024;

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
