import { workspaceFileBroker } from '@/lib/execution/sandbox/brokers/workspace-file'
import { defineSandboxTask } from '@/lib/execution/sandbox/define-task'
import type { SandboxTaskInput } from '@/lib/execution/sandbox/types'

export const docxGenerateTask = defineSandboxTask<SandboxTaskInput>({
  id: 'docx-generate',
  timeoutMs: 60_000,
  bundles: ['docx'],
  brokers: [workspaceFileBroker],
  bootstrap: `
    const docx = globalThis.__bundles['docx'];
    if (!docx) throw new Error('docx bundle not loaded');
    globalThis.docx = docx;
    globalThis.__docxSections = [];
    globalThis.addSection = (section) => {
      globalThis.__docxSections.push(section);
    };
    // Set globalThis.__docxDocOptions = { styles: {...}, numbering: {...} } in chunk 1
    // to configure document-wide styles and numbering in chunked (addSection) mode.
    globalThis.__docxDocOptions = null;

    // Page geometry constants (twips, 1 twip = 1/1440 inch) for US Letter
    globalThis.PAGE_W    = 12240;  // 8.5"
    globalThis.PAGE_H    = 15840;  // 11"
    globalThis.MARGIN    = 1440;   // 1" margins
    globalThis.CONTENT_W = 9360;   // PAGE_W - 2 * MARGIN

    // 6 MB raw ≈ 8 MB base64; reject above this to avoid sandbox OOM.
    const _MAX_IMG_B64 = 8 * 1024 * 1024;

    /**
     * getFileBase64(fileId) — load a workspace file as a full data URI string.
     * Returns the complete "data:image/png;base64,..." string.
     * Use addImage() rather than passing this directly to ImageRun.
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
     * addImage(fileId, opts) — fetch a workspace file and return a docx.ImageRun.
     * Required opts: width, height (pixels or EMUs via transformation option).
     * Example:
     *   new docx.Paragraph({ children: [await addImage('abc123', { width: 200, height: 100 })] })
     */
    globalThis.addImage = async function addImage(fileId, opts) {
      if (!opts || opts.width == null || opts.height == null) {
        throw new Error('addImage: opts must include width and height (in pixels)');
      }
      const dataUri = await globalThis.getFileBase64(fileId);
      const comma = dataUri.indexOf(',');
      if (comma === -1) throw new Error('addImage: invalid data URI (no comma separator)');
      const header = dataUri.slice(0, comma);
      const base64 = dataUri.slice(comma + 1);
      const mime = header.split(';')[0].replace('data:', '');
      const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' };
      const ext = extMap[mime];
      if (!ext) throw new Error('addImage: unsupported image type "' + mime + '". Use PNG, JPEG, GIF, BMP, or SVG.');
      if (!globalThis.Buffer) throw new Error('addImage: Buffer polyfill missing — ensure docx bundle is loaded');
      const { width, height, type: _t, data: _d, transformation: userTransform, ...passThrough } = opts;
      return new globalThis.docx.ImageRun(Object.assign(passThrough, {
        data: globalThis.Buffer.from(base64, 'base64'),
        type: ext,
        transformation: Object.assign({ width, height }, userTransform || {}),
      }));
    };
  `,
  // JSZip's browser build doesn't support nodebuffer output, so we go through
  // base64 and decode back to bytes inside the isolate (avoids DataURL / Blob).
  finalize: `
    let doc = globalThis.doc;
    if (!doc && globalThis.__docxSections.length > 0) {
      doc = new globalThis.docx.Document({
        ...(globalThis.__docxDocOptions || {}),
        sections: globalThis.__docxSections,
      });
    }
    if (!doc) {
      throw new Error('No document created. Use addSection({ children: [...] }) for chunked writes, or set globalThis.doc = new docx.Document({...}) for a single write.');
    }
    const b64 = await globalThis.docx.Packer.toBase64String(doc);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Uint8Array(128);
    for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
    const clean = b64.replace(/=+$/, '');
    const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let pos = 0;
    for (let i = 0; i < clean.length; i += 4) {
      const c0 = lookup[clean.charCodeAt(i)];
      const c1 = lookup[clean.charCodeAt(i + 1)];
      const c2 = lookup[clean.charCodeAt(i + 2)];
      const c3 = lookup[clean.charCodeAt(i + 3)];
      out[pos++] = (c0 << 2) | (c1 >> 4);
      if (i + 2 < clean.length) out[pos++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
      if (i + 3 < clean.length) out[pos++] = ((c2 & 0x03) << 6) | c3;
    }
    return out.subarray(0, pos);
  `,
  toResult: (bytes) => Buffer.from(bytes),
})
