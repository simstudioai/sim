/** Whether an edit-operation batch tries to set or clear a Function block's `sandboxId`. */
export function operationsReferenceSimSandbox(
  operations: ReadonlyArray<{ params?: Record<string, unknown> }>
): boolean {
  return operations.some((operation) => {
    const inputs = operation.params?.inputs
    return Boolean(inputs && typeof inputs === 'object' && 'sandboxId' in inputs)
  })
}
