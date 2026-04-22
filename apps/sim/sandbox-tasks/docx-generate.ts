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
    globalThis.getFileBase64 = async (fileId) => {
      const res = await globalThis.__brokers.workspaceFile({ fileId });
      return res.dataUri;
    };
  `,
  // JSZip's browser build doesn't support nodebuffer output, so we go through
  // base64 and decode back to bytes inside the isolate (avoids DataURL / Blob).
  finalize: `
    let doc = globalThis.doc;
    if (!doc && globalThis.__docxSections.length > 0) {
      doc = new globalThis.docx.Document({ sections: globalThis.__docxSections });
    }
    if (!doc) {
      throw new Error('No document created. Use addSection({ children: [...] }) for chunked writes, or set doc = new docx.Document({...}) for a single write.');
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
