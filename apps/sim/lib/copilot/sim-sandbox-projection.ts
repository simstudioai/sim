import type { CopilotSanitizationOptions } from '@/lib/workflows/sanitization/json-sanitizer'

export const HIDE_SIM_SANDBOX_INPUTS: CopilotSanitizationOptions = {
  hiddenInputIdsByBlockType: new Map([['function', new Set(['sandboxId'])]]),
}

/** Whether an edit_workflow operation tries to set or clear Function sandboxId. */
export function operationsReferenceSimSandbox(
  operations: ReadonlyArray<{ params?: Record<string, unknown> }>
): boolean {
  return operations.some((operation) => {
    const inputs = operation.params?.inputs
    return Boolean(inputs && typeof inputs === 'object' && 'sandboxId' in inputs)
  })
}
