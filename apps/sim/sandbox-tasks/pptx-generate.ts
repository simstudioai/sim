import { workspaceFileBroker } from '@/lib/execution/sandbox/brokers/workspace-file'
import { defineSandboxTask } from '@/lib/execution/sandbox/define-task'
import type { SandboxTaskInput } from '@/lib/execution/sandbox/types'

export const pptxGenerateTask = defineSandboxTask<SandboxTaskInput>({
  id: 'pptx-generate',
  timeoutMs: 60_000,
  bundles: ['pptxgenjs'],
  brokers: [workspaceFileBroker],
  bootstrap: `
    const PptxGenJS = globalThis.__bundles['pptxgenjs'];
    if (!PptxGenJS) throw new Error('pptxgenjs bundle not loaded');
    globalThis.pptx = new PptxGenJS();
    globalThis.pptx.layout = 'LAYOUT_16x9';

    // Slide geometry for LAYOUT_16x9 (inches)
    globalThis.SLIDE_W   = 10;
    globalThis.SLIDE_H   = 5.625;
    globalThis.MARGIN    = 0.5;
    globalThis.CONTENT_W = 9;    // SLIDE_W - 2 * MARGIN
    globalThis.CONTENT_H = 3.8;  // usable body height below a standard title row

    // ── Image helpers ──────────────────────────────────────────────────────────
    // 6 MB raw ≈ 8 MB base64; reject above this to avoid sandbox OOM.
    const _MAX_IMG_B64 = 8 * 1024 * 1024;

    /**
     * getFileBase64(fileId) — load a workspace file as a data URI string.
     * PptxGenJS data format: "image/png;base64,<data>" (no "data:" prefix).
     * Use as: slide.addImage({ data: await getFileBase64(fileId), x, y, w, h })
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
      // PptxGenJS expects "image/png;base64,..." — strip the leading "data:" if present
      return res.dataUri.replace(/^data:/, '');
    };

    /**
     * addImage(slide, fileId, opts) — fetch a workspace file and embed it.
     * Required opts: x, y, w, h (inches).
     * Example: await addImage(slide, 'abc123', { x: 0.5, y: 1, w: 2, h: 1 });
     */
    globalThis.addImage = async function addImage(slide, fileId, opts) {
      if (!opts || opts.x == null || opts.y == null || opts.w == null || opts.h == null) {
        throw new Error('addImage: opts must include x, y, w, and h (in inches)');
      }
      const data = await globalThis.getFileBase64(fileId);
      slide.addImage(Object.assign({}, opts, { data }));
    };
  `,
  finalize: `
    if (!globalThis.pptx) {
      throw new Error('No presentation found. globalThis.pptx was overwritten — use the pre-initialized instance and call addSlide() on it to build your presentation.');
    }
    const bytes = await globalThis.pptx.write({ outputType: 'uint8array' });
    return bytes;
  `,
  toResult: (bytes) => Buffer.from(bytes),
})
