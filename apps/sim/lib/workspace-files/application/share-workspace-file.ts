import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalExecutionActorUserId } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import {
  type ShareAuthType,
  type ShareRecord,
  sharePasswordSchema,
} from '@/lib/api/contracts/public-shares'
import { admitContent, ContentRefusedError, isCopilotPrincipal } from '@/lib/core/application'
import { resolveCopilotSecretReference } from '@/lib/core/application/environment-reference'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { parseExactEnvironmentReference } from '@/lib/environment/reference'
import {
  getShareForResource,
  getWorkspaceSharesForResources,
  ShareValidationError,
  upsertFileShare,
} from '@/lib/public-shares/manager'
import {
  findListedWorkspaceFiles,
  getWorkspaceFile,
  loadActiveWorkspaceContext,
} from '@/lib/uploads/contexts/workspace/file-manager'
import {
  getBoundWorkspaceFileSecretProvenanceByIdentity,
  getCurrentWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { downloadFileStream } from '@/lib/uploads/core/storage-service'
import { loadPublishedCompiledDocInputs } from '@/lib/uploads/documents/compiled-store'
import { getFileExtension, isRenderableDocumentName } from '@/lib/uploads/utils/file'
import { workspaceFileProvenanceIdentity } from '@/lib/workspace-files/application/admit-file-content'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/file-context'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS } from '@/lib/workspace-files/limits'
import { validatePublicFileSharing } from '@/ee/access-control/utils/permission-check'

const logger = createLogger('WorkspaceFileShare')

export interface GetWorkspaceFileShareInput {
  fileId: string
  assertedWorkspaceId?: string
}

export interface GetWorkspaceFileShareResult {
  share: ShareRecord | null
}

export interface GetWorkspaceFileSharesInput {
  workspaceId: string
  fileIds: string[]
}

export interface GetWorkspaceFileSharesResult {
  shares: Map<string, ShareRecord>
}

export interface UpdateWorkspaceFileShareInput {
  fileId: string
  assertedWorkspaceId?: string
  isActive: boolean
  authType?: ShareAuthType
  password?: string
  allowedEmails?: string[]
  token?: string
  noOpIfInactive?: boolean
}

export interface UpdateWorkspaceFileShareResult {
  share: ShareRecord
}

export class WorkspaceFileShareNoopError extends Error {
  constructor() {
    super('Workspace file is not currently shared')
    this.name = 'WorkspaceFileShareNoopError'
  }
}

/**
 * A live link serves a file's current bytes to whoever opens it, outside every gate: no registry
 * redacts them and no workbench history follows them. So Chat may create or see a link only to a
 * file holding no recorded secret, whichever surface it acts through (D1).
 */
function isShareableByChat(provenance: WorkspaceFileSecretProvenance | undefined): boolean {
  return (
    provenance?.status === 'unrecorded' ||
    (provenance?.status === 'exact' && provenance.entries.length === 0)
  )
}

/** The ids whose live links Chat may see; every other caller sees them all, unread. */
async function admitSharedFiles(
  principal: Principal,
  workspaceId: string,
  fileIds: readonly string[]
): Promise<Set<string>> {
  await admitContent(principal, [])
  if (!isCopilotPrincipal(principal) || fileIds.length === 0) return new Set(fileIds)
  const provenance = await getCurrentWorkspaceFileSecretProvenance(workspaceId, fileIds)
  const shareable = new Set(fileIds.filter((id) => isShareableByChat(provenance.get(id))))
  if (shareable.size === 0) return shareable
  const files = await findListedWorkspaceFiles(workspaceId, [...shareable])
  for (const id of shareable) {
    const file = files.get(id)
    if (!file || file.id !== id || !isRenderableDocumentName(file.name)) continue
    const source = await downloadFileStream({
      key: file.key,
      context: file.storageContext ?? 'workspace',
    })
    const contributors = await loadPublishedCompiledDocInputs(
      workspaceId,
      source,
      getFileExtension(file.name)
    )
    const bound = await getBoundWorkspaceFileSecretProvenanceByIdentity(workspaceId, [
      workspaceFileProvenanceIdentity(file),
      ...contributors,
    ])
    if ([...bound.values()].some((value) => !isShareableByChat(value))) shareable.delete(id)
  }
  return shareable
}

export const getWorkspaceFileShare = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readShare,
  resolveContext: ({ input }: { input: GetWorkspaceFileShareInput }) =>
    resolveActiveWorkspaceFileContext(input),
  async execute({ context, principal }): Promise<GetWorkspaceFileShareResult> {
    const share = await getShareForResource('file', context.fileId)
    const active = share?.isActive ? [context.fileId] : []
    const visible = await admitSharedFiles(principal, context.workspaceId, active)
    if (active.length > visible.size) throw new ContentRefusedError('workspace-file')
    return { share }
  },
})

export const getWorkspaceFileShares = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readShare,
  async resolveContext({ input }: { input: GetWorkspaceFileSharesInput }) {
    const workspace = await loadActiveWorkspaceContext(input.workspaceId)
    if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
    return workspace
  },
  async execute({ input, context, principal }): Promise<GetWorkspaceFileSharesResult> {
    const fileIds = [...new Set(input.fileIds)]
    if (fileIds.length > MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS) {
      throw new OrchestrationError(
        'payload_too_large',
        `Cannot read shares for more than ${MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS} files`
      )
    }
    const shares = await getWorkspaceSharesForResources('file', context.workspaceId, fileIds)
    const admitted = await admitSharedFiles(
      principal,
      context.workspaceId,
      [...shares].filter(([, share]) => share.isActive).map(([fileId]) => fileId)
    )
    return {
      shares: new Map(
        [...shares].filter(([fileId, share]) => !share.isActive || admitted.has(fileId))
      ),
    }
  },
})

/**
 * The password to store for a password-gated share.
 *
 * The v2 contract admits a whole-value `{{NAME}}` reference below the share
 * password minimum, because only here is it known whether the caller is Sim's
 * agent: the agent's reference resolves to the variable's value, anyone else's
 * stays literal, and either way the result is held to the share password rules.
 * Other passwords pass through unchanged, with the length rules of the surface
 * that admitted them.
 */
async function resolveSharePassword(
  principal: Principal,
  workspaceId: string,
  password: string | undefined
): Promise<string | undefined> {
  if (!parseExactEnvironmentReference(password)) return password
  const resolved = await resolveCopilotSecretReference(principal, workspaceId, password, 'password')
  const validated = sharePasswordSchema.safeParse(resolved)
  if (!validated.success) {
    throw new OrchestrationError('validation', validated.error.issues[0].message)
  }
  return validated.data
}

export const updateWorkspaceFileShare = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.updateShare,
  async resolveContext({ input }: { input: UpdateWorkspaceFileShareInput }) {
    const canonical = await resolveActiveWorkspaceFileContext(input)
    const file = await getWorkspaceFile(canonical.workspaceId, canonical.fileId, {
      throwOnError: true,
    })
    if (!file) throw new OrchestrationError('not_found', 'File not found')
    return { ...canonical, file }
  },
  async execute({ principal, input, context }): Promise<UpdateWorkspaceFileShareResult> {
    const userId = resolvePrincipalExecutionActorUserId(principal)
    if (!userId) {
      throw new OrchestrationError(
        'forbidden',
        'File sharing requires a user subject or execution actor'
      )
    }

    const existingShare = await getShareForResource('file', context.fileId)
    if (input.noOpIfInactive && !input.isActive && !existingShare?.isActive) {
      throw new WorkspaceFileShareNoopError()
    }

    const effectiveAuthType = input.authType ?? existingShare?.authType ?? 'public'
    if (input.isActive) {
      await validatePublicFileSharing(userId, context.workspaceId, effectiveAuthType)
      const [shareable] = await admitSharedFiles(principal, context.workspaceId, [context.fileId])
      if (!shareable) throw new ContentRefusedError('workspace-file')
    } else {
      await admitContent(principal, [])
    }

    const password =
      input.isActive && effectiveAuthType === 'password'
        ? await resolveSharePassword(principal, context.workspaceId, input.password)
        : input.password

    let share: ShareRecord
    try {
      share = await upsertFileShare({
        workspaceId: context.workspaceId,
        fileId: context.fileId,
        userId,
        isActive: input.isActive,
        authType: input.authType,
        password,
        allowedEmails: input.allowedEmails,
        token: input.token,
      })
    } catch (error) {
      if (error instanceof ShareValidationError) {
        throw new OrchestrationError('validation', error.message)
      }
      throw error
    }
    if (!share) throw new Error('Updating workspace file share returned no share')

    logger.info(`${input.isActive ? 'Enabled' : 'Disabled'} share for workspace file`, {
      workspaceId: context.workspaceId,
      fileId: context.fileId,
      principalKind: principal.kind,
    })
    return { share }
  },
  projectAudit: ({ input, context }) => ({
    action: input.isActive ? AuditAction.FILE_SHARED : AuditAction.FILE_SHARE_DISABLED,
    resourceType: AuditResourceType.FILE,
    resourceId: context.fileId,
    resourceName: context.file.name,
    description: `${input.isActive ? 'Enabled' : 'Disabled'} public share for "${context.file.name}"`,
  }),
})
