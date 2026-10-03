import { AsyncLocalStorage } from 'node:async_hooks'
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
