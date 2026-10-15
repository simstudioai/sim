import { AsyncLocalStorage } from 'node:async_hooks'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/file-secret-provenance'

/** Single-file deliveries name the canonical file for attribution; aggregates have no single file ID. */
type WorkspaceFileDeliveryObserver = (
  provenance: WorkspaceFileSecretProvenance | undefined,
  fileId?: string
) => Promise<void>

const observer = new AsyncLocalStorage<WorkspaceFileDeliveryObserver>()
/** Internal transport evidence observes authorized bytes without changing public API admission or output. */
export function observeWorkspaceFileDelivery<T>(
  observe: WorkspaceFileDeliveryObserver,
  execute: () => T
): T {
  return observer.run(observe, execute)
}
export function hasWorkspaceFileDeliveryObserver(): boolean {
  return observer.getStore() !== undefined
}
/**
 * Runs before the canonical use case returns bytes to its transport. An observer that refuses the
 * file throws, so its bytes are never read.
 */
export async function reportWorkspaceFileDelivery(
  provenance: WorkspaceFileSecretProvenance | undefined,
  fileId?: string
): Promise<void> {
  await observer.getStore()?.(provenance, fileId)
}
