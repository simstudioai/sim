import type { SandboxTask } from '@/lib/execution/sandbox/types'
import { docxGenerateTask } from '@/sandboxes/docx-generate'
import { pdfGenerateTask } from '@/sandboxes/pdf-generate'
import { pptxGenerateTask } from '@/sandboxes/pptx-generate'
import { workflowTestCollectTask, workflowTestRunTask } from '@/sandboxes/workflow-test'

/**
 * Every piece of user code that runs inside the isolated-vm sandbox is defined
 * here. Adding a new sandbox task = add one file under `apps/sim/sandboxes/`
 * and register it below. Mirrors the `apps/sim/background/` pattern.
 */
export const SANDBOX_TASKS = {
  'pptx-generate': pptxGenerateTask,
  'docx-generate': docxGenerateTask,
  'pdf-generate': pdfGenerateTask,
  'workflow-test-run': workflowTestRunTask,
  'workflow-test-collect': workflowTestCollectTask,
} as const satisfies Record<string, SandboxTask>

export type SandboxTaskId = keyof typeof SANDBOX_TASKS

export function getSandboxTask(id: SandboxTaskId): SandboxTask {
  const task = SANDBOX_TASKS[id]
  if (!task) {
    throw new Error(`Unknown sandbox task: "${id}"`)
  }
  return task
}
