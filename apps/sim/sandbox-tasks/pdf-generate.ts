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
    globalThis.embedImage = async (dataUri) => {
      const comma = dataUri.indexOf(',');
      const header = dataUri.slice(0, comma);
      const base64 = dataUri.slice(comma + 1);
      const binary = globalThis.Buffer ? globalThis.Buffer.from(base64, 'base64') : null;
      if (!binary) throw new Error('Buffer polyfill missing');
      const mime = header.split(';')[0].split(':')[1] || '';
      if (mime.includes('png')) return globalThis.pdf.embedPng(binary);
      return globalThis.pdf.embedJpg(binary);
    };
    globalThis.getFileBase64 = async (fileId) => {
      const res = await globalThis.__brokers.workspaceFile({ fileId });
      return res.dataUri;
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
