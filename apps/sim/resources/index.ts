/**
 * The three axes every resource view is mounted against.
 *
 * - {@link ResourceSource} — where the data comes from, and by what address.
 * - {@link ResourceGrants} — what this viewer may do.
 * - {@link ResourceHost} — who owns the URL, the router, the document frame.
 *
 * Pure TypeScript on purpose: no React, no `'use client'`, so a Server
 * Component can build a share source during SSR.
 */
export type { FileContentUrlOptions, FileViewRecord } from '@/resources/file-source'
export {
  fileCacheScope,
  fileContentUrl,
  fileImageSrc,
  fileWorkspaceId,
  shareFileRecord,
} from '@/resources/file-source'
export type {
  ResourceGrants,
  WorkspacePermissionSnapshot,
} from '@/resources/grants'
export { grantsForShare, grantsFromPermissions } from '@/resources/grants'
export type { ResourceHost } from '@/resources/host'
export { hostOwnsUrl } from '@/resources/host'
export type {
  InterfaceModuleSeed,
  ResourceKind,
  ResourceSeed,
  ResourceSeedMap,
  ShareableKind,
} from '@/resources/kinds'
export { isResourceKind, RESOURCE_KINDS } from '@/resources/kinds'
export type {
  ResourceLink,
  ResourceSource,
  ShareSource,
  ShareSourceInput,
  UnavailableReason,
  WorkspaceSource,
  WorkspaceSourceInput,
} from '@/resources/source'
export { shareSource, workspaceSource } from '@/resources/source'
