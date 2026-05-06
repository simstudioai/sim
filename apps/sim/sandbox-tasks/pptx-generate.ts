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
    globalThis.getFileBase64 = async (fileId) => {
      const res = await globalThis.__brokers.workspaceFile({ fileId });
      return res.dataUri;
    };
  `,
  finalize: `
    const bytes = await globalThis.pptx.write({ outputType: 'uint8array' });
    return bytes;
  `,
  toResult: (bytes) => Buffer.from(bytes),
})
