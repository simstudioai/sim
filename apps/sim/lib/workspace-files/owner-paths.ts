import {
  type FileOwnerAdapters,
  requireFileOwnerAdapter,
} from '@/lib/workspace-files/owner-adapters'
import type { FileOwner } from '@/lib/workspace-files/ownership'

const namespaces: FileOwnerAdapters<(entityId: string, path: string) => string> = {
  workspace: (_entityId, path) => path,
  project: (entityId, path) => `projects/${encodeURIComponent(entityId)}/${path}`,
}

/** Preserves the legacy workspace alias while other registered owners have explicit namespaces. */
export function fileOwnerVfsPath(owner: FileOwner, path: string): string {
  return requireFileOwnerAdapter(namespaces, owner)(owner.entityId, path)
}
