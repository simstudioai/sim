import type { FolderResourceType } from '@/lib/api/contracts/folders'

export type FolderQueryScope = 'active' | 'archived'

/**
 * `resourceType` is part of the key, not an implicit default, because one workspace holds
 * an independent folder tree per resource. Without it the Knowledge, Tables, and Workflows
 * folder lists would share a single cache entry and overwrite each other.
 *
 * Typed against the full `FolderResourceType` rather than the narrower set the API serves,
 * so a cached row's own `resourceType` can be used to address its list without a cast.
 */
export const folderKeys = {
  all: ['folders'] as const,
  lists: () => [...folderKeys.all, 'list'] as const,
  resource: (resourceType: FolderResourceType = 'workflow') =>
    [...folderKeys.lists(), resourceType] as const,
  list: (
    workspaceId: string | undefined,
    scope: FolderQueryScope = 'active',
    resourceType: FolderResourceType = 'workflow'
  ) => [...folderKeys.resource(resourceType), workspaceId ?? '', scope] as const,
}
