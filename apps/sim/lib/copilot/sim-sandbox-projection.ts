import { SIM_SANDBOXES_ENTITLEMENT } from '@/lib/copilot/entitlements'

export const RESTRICTED_SIM_SANDBOX_INPUTS = new Map([
  [
    'sandboxId',
    {
      requiredEntitlement: SIM_SANDBOXES_ENTITLEMENT,
      reason:
        'Selecting or clearing a Sim sandbox requires an active Max or Enterprise plan. Preserve any existing selection unless the user upgrades.',
    },
  ],
])

/** Whether an edit_workflow operation tries to set or clear Function sandboxId. */
export function operationsReferenceSimSandbox(
  operations: ReadonlyArray<{ params?: Record<string, unknown> }>
): boolean {
  return operations.some((operation) => {
    const inputs = operation.params?.inputs
    return Boolean(inputs && typeof inputs === 'object' && 'sandboxId' in inputs)
  })
}
