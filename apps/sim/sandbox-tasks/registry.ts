import type { SandboxTask } from '@/lib/execution/sandbox/types'
import { docxGenerateTask } from '@/sandbox-tasks/docx-generate'
import { pdfGenerateTask } from '@/sandbox-tasks/pdf-generate'
import { pptxGenerateTask } from '@/sandbox-tasks/pptx-generate'

/**
 * Every piece of user code that runs inside the isolated-vm sandbox is defined
 * here. Adding a new sandbox task = add one file under `apps/sim/sandbox-tasks/`
 * and register it below. Mirrors the `apps/sim/background/` pattern.
 */
export const SANDBOX_TASKS = {
  'pptx-generate': pptxGenerateTask,
  'docx-generate': docxGenerateTask,
  'pdf-generate': pdfGenerateTask,
} as const satisfies Record<string, SandboxTask>

export type SandboxTaskId = keyof typeof SANDBOX_TASKS

export function getSandboxTask(id: SandboxTaskId): SandboxTask {
  const task = SANDBOX_TASKS[id]
  if (!task) {
    throw new Error(`Unknown sandbox task: "${id}"`)
  }
  return task
}
