import { assertFolderMutable } from '@sim/platform-authz/resource-lock'
import type { FolderResourceType } from '@/lib/api/contracts/folders'

/**
 * Per-resourceType policy for folder mutations. All four resourceTypes now
 * support the same lock-cascade enforcement via the generic locking engine
 * in `@sim/platform-authz/resource-lock`.
 */
export interface FolderResourcePolicy {
  /** Throws when `folderId` (or an ancestor) is locked. */
  assertMutable: (folderId: string | null) => Promise<void>
  /** Whether this resourceType's folders support the `locked` field at all. */
  supportsLocking: boolean
}

export const FOLDER_RESOURCE_POLICIES: Record<FolderResourceType, FolderResourcePolicy> = {
  workflow: {
    assertMutable: (id) => assertFolderMutable(id, 'workflow'),
    supportsLocking: true,
  },
  file: {
    assertMutable: (id) => assertFolderMutable(id, 'file'),
    supportsLocking: true,
  },
  knowledge_base: {
    assertMutable: (id) => assertFolderMutable(id, 'knowledge_base'),
    supportsLocking: true,
  },
  table: {
    assertMutable: (id) => assertFolderMutable(id, 'table'),
    supportsLocking: true,
  },
}
