import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import {
  type ActiveWorkspaceFileContext,
  loadActiveWorkspaceFileContext,
  loadWorkspaceFileLifecycleContext,
  resolveFileReference,
  type WorkspaceFileLifecycleContext,
} from '@/lib/uploads/contexts/workspace/file-manager'
import { isWorkspaceFileVfsPath } from '@/lib/vfs/path'
import { UnresolvedWorkspaceFileVfsPathError } from '@/lib/workspace-files/application/unresolved-vfs-path'
import { ownedFileKind } from '@/lib/workspace-files/owned-files'
import { matchesFileOwner } from '@/lib/workspace-files/ownership'

/** How a use case names one workspace file: its id, or with `acceptVfsPath` its exact VFS path. */
export interface WorkspaceFileTargetInput {
  fileId: string
  assertedWorkspaceId?: string
  /**
   * Also accept the file's exact `files/…` VFS path as `fileId`, resolved inside
   * `assertedWorkspaceId` to a live workspace file. Only the public v2 surface sets it; every
   * other caller passes ids, and a path-shaped string there stays an unknown id.
   */
  acceptVfsPath?: boolean
}

export interface WorkspaceFileContextInput extends WorkspaceFileTargetInput {
  includeDeleted?: boolean
  /**
   * Admit a chat upload (`context = 'mothership'`) addressed by its own id. Only read
   * use cases set this: chat uploads stay out of listings and closed to writes.
   */
  includeChatUploads?: boolean
  /**
   * Admit a file another resource owns (a test file or a release body) for this principal under
   * its owner's policy. Only content reads and writes pass it; every other file operation never
   * reaches an owned file.
   */
  ownedFilePrincipal?: Principal
}

/**
 * The principals the owners' operations admit: people and Copilot acting for one. Workspace API
 * keys, system callers, and the executor's delegation never reach an owned file.
 */
function isOwnedFilePrincipal(principal: Principal): boolean {
  if (principal.kind === 'delegated') return principal.serviceId === 'copilot'
  return (
    principal.kind === 'session' ||
    principal.kind === 'personal_api_key' ||
    principal.kind === 'oauth_access_token'
  )
}

/**
 * A file another resource owns follows its owner: it needs a live owner with its feature
 * enabled, and admits only the owners' principal kinds.
 */
export async function assertOwnedFileAccess(
  principal: Principal,
  context: ActiveWorkspaceFileContext,
  executor?: DbOrTx
): Promise<void> {
  const kind = ownedFileKind(context.fileContext)
  if (!kind) return
  if (!isOwnedFilePrincipal(principal)) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  await kind.assertOwnerAccess(context.fileId, context.workspaceOrganizationId, executor)
}

function requireWorkspaceFileContext<C extends ActiveWorkspaceFileContext>(
  canonical: C | null,
  assertedWorkspaceId: string | undefined
): C {
  if (
    !canonical ||
    (assertedWorkspaceId !== undefined &&
      !matchesFileOwner(
        { entityType: 'workspace', entityId: canonical.workspaceId },
        { entityType: 'workspace', entityId: assertedWorkspaceId }
      ))
  ) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  return canonical
}

function namesVfsPath(input: WorkspaceFileTargetInput): boolean {
  return input.acceptVfsPath === true && isWorkspaceFileVfsPath(input.fileId)
}

/**
 * A path becomes an id first, so the canonical load and every authorization check run unchanged.
 * The resolver's `validation` is decided from the reference alone, before any read, and says
 * nothing about the workspace. Every other refusal it raises was read from the workspace, as is a
 * path that names no single live file, so each leaves as an
 * {@link UnresolvedWorkspaceFileVfsPathError} that only a caller the operation admits sees.
 */
async function resolveFileId(input: WorkspaceFileContextInput): Promise<string> {
  if (!namesVfsPath(input)) return input.fileId
  const workspaceId = input.assertedWorkspaceId
  if (workspaceId === undefined) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  const file = await resolveFileReference(
    { entityType: 'workspace', entityId: workspaceId },
    input.fileId
  ).catch((error: unknown) => {
    if (!(error instanceof OrchestrationError) || error.code === 'validation') throw error
    if (error.code === 'conflict') {
      throw new UnresolvedWorkspaceFileVfsPathError(
        workspaceId,
        'validation',
        `"${input.fileId}" names more than one file whose names display alike; pass the file id instead`
      )
    }
    throw new UnresolvedWorkspaceFileVfsPathError(workspaceId, error.code, error.message)
  })
  if (!file) {
    throw new UnresolvedWorkspaceFileVfsPathError(workspaceId, 'not_found', 'File not found')
  }
  return file.id
}

export async function resolveActiveWorkspaceFileContext(
  input: WorkspaceFileContextInput
): Promise<ActiveWorkspaceFileContext> {
  const loaded = await loadActiveWorkspaceFileContext(await resolveFileId(input), {
    includeDeleted: input.includeDeleted,
    includeChatUploads: input.includeChatUploads,
    includeOwnedFiles: Boolean(input.ownedFilePrincipal),
  })
  if (!loaded && namesVfsPath(input) && input.assertedWorkspaceId) {
    throw new UnresolvedWorkspaceFileVfsPathError(
      input.assertedWorkspaceId,
      'not_found',
      'File not found'
    )
  }
  const canonical = requireWorkspaceFileContext(loaded, input.assertedWorkspaceId)
  if (input.ownedFilePrincipal) await assertOwnedFileAccess(input.ownedFilePrincipal, canonical)
  return canonical
}

export async function resolveWorkspaceFileLifecycleContext(
  input: Pick<WorkspaceFileTargetInput, 'fileId' | 'assertedWorkspaceId'>
): Promise<WorkspaceFileLifecycleContext> {
  return requireWorkspaceFileContext(
    await loadWorkspaceFileLifecycleContext(input.fileId),
    input.assertedWorkspaceId
  )
}
