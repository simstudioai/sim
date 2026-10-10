import { AsyncLocalStorage } from 'node:async_hooks'
import type { Principal } from '@sim/auth/principal'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'

const observer = new AsyncLocalStorage<
  (provenance?: WorkspaceFileSecretProvenance) => Promise<void>
>()
/** Internal transport evidence observes authorized bytes without changing public API admission or output. */
export function observeWorkspaceFileDelivery<T>(
  observe: (provenance?: WorkspaceFileSecretProvenance) => Promise<void>,
  execute: () => T
): T {
  return observer.run(observe, execute)
}
export function hasWorkspaceFileDeliveryObserver(): boolean {
  return observer.getStore() !== undefined
}
/** Runs before the canonical use case returns bytes to its transport. */
export async function reportWorkspaceFileDelivery(
  provenance?: WorkspaceFileSecretProvenance
): Promise<void> {
  await observer.getStore()?.(provenance)
}

/** A Chat read reached stored bytes with no observer to record their secret provenance. */
export class WorkspaceFileDeliveryUnobservedError extends Error {
  constructor() {
    super('File read provenance is unavailable. Retry the read.')
    this.name = 'WorkspaceFileDeliveryUnobservedError'
  }
}

/**
 * Refuses a Chat caller before any bytes load unless a delivery observer is installed, so a secret
 * in the content cannot reach a model without its provenance being recorded, whatever transport
 * composed the call. Keyed on the Copilot service, not on delegation: a workflow run is delegated
 * too, but its reads feed blocks rather than Chat's model, and nothing observes them.
 */
export function requireCopilotWorkspaceFileDeliveryObserver(principal: Principal): void {
  if (
    principal.kind === 'delegated' &&
    principal.serviceId === 'copilot' &&
    !hasWorkspaceFileDeliveryObserver()
  ) {
    throw new WorkspaceFileDeliveryUnobservedError()
  }
}
