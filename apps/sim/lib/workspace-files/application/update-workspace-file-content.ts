import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  ContentVersionConflictError,
  updateWorkspaceFileContent as updateStoredWorkspaceFileContent,
  type VersionedWorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import {
  EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { parseWorkspaceFileRevision } from '@/lib/workspace-files/application/file-revision'
import { resolveWorkspaceFileVersionWrite } from '@/lib/workspace-files/application/file-version-write'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'
import { MAX_WORKSPACE_FILE_CONTENT_BYTES } from '@/lib/workspace-files/orchestration'

const logger = createLogger('UpdateWorkspaceFileContent')

export interface UpdateWorkspaceFileContentInput {
  fileId: string
  assertedWorkspaceId?: string
  content: string
  encoding: 'utf-8' | 'base64'
  contentType?: string
  provenanceMode?: 'replace_empty' | 'preserve'
  secretProvenance?: WorkspaceFileSecretProvenance
  syncLiveDoc?: boolean
  expectedUpdatedAt?: Date
  /**
   * Refuse the write unless the file still holds exactly this content, as reported by the
   * `revision` an earlier read or write returned.
   */
  expectedRevision?: string
}

export interface UpdateWorkspaceFileContentResult {
  /** The updated record, carrying the number of the version this write recorded. */
  file: VersionedWorkspaceFileRecord
}

export interface UpdateWorkspaceFileContentBufferInput
  extends Omit<UpdateWorkspaceFileContentInput, 'content' | 'encoding'> {
  content: Buffer
}

async function updateAuthorizedWorkspaceFileContent({
  principal,
  input,
  content,
  canonical,
}: {
  principal: Principal
  input: Omit<UpdateWorkspaceFileContentInput, 'content' | 'encoding'>
  content: Buffer
  canonical: Awaited<ReturnType<typeof resolveActiveWorkspaceFileContext>>
}): Promise<UpdateWorkspaceFileContentResult> {
  const attribution = resolvePrincipalAttribution(principal, {
    workspaceBillingOwnerUserId: canonical.billedAccountUserId,
  })
  const expectedUpdatedAt = input.expectedRevision
    ? parseWorkspaceFileRevision(input.expectedRevision)
    : input.expectedUpdatedAt
  let file: VersionedWorkspaceFileRecord
  try {
    file = await updateStoredWorkspaceFileContent(
      canonical.workspaceId,
      canonical.fileId,
      attribution.attributedUserId,
      content,
      input.contentType,
      {
        version: resolveWorkspaceFileVersionWrite(principal),
        ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        syncLiveDoc: input.syncLiveDoc,
        secretProvenancePolicy: {
          ...(input.provenanceMode === 'preserve'
            ? { mode: 'preserve' as const }
            : {
                mode: 'replace' as const,
                provenance: input.secretProvenance ?? EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE,
              }),
        },
      }
    )
  } catch (error) {
    if (error instanceof ContentVersionConflictError) {
      throw new OrchestrationError('conflict', error.message)
    }
    throw error
  }

  logger.info('Updated workspace file content', {
    workspaceId: canonical.workspaceId,
    fileId: canonical.fileId,
    size: content.length,
    principalKind: principal.kind,
  })
  return { file }
}

function projectUpdateWorkspaceFileContentAudit(result: UpdateWorkspaceFileContentResult) {
  return {
    action: AuditAction.FILE_UPDATED,
    resourceType: AuditResourceType.FILE,
    resourceId: result.file.id,
    resourceName: result.file.name,
    description: `Updated content of file "${result.file.name}"`,
    metadata: { contentSize: result.file.size },
  } as const
}

const admitUpdateWorkspaceFileContentUseCase = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.updateContent,
  resolveContext: ({ input }: { input: { fileId: string } }) =>
    resolveActiveWorkspaceFileContext(input),
  async execute() {},
})

export async function admitUpdateWorkspaceFileContent(
  principal: Principal,
  fileId: string
): Promise<void> {
  await admitUpdateWorkspaceFileContentUseCase.execute({ principal, input: { fileId } })
}

export const updateWorkspaceFileContent = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.updateContent,
  resolveContext: ({ input }: { input: UpdateWorkspaceFileContentInput }) =>
    resolveActiveWorkspaceFileContext(input),
  async execute({ principal, input, context }): Promise<UpdateWorkspaceFileContentResult> {
    const content = Buffer.from(input.content, input.encoding === 'base64' ? 'base64' : 'utf-8')
    if (content.length > MAX_WORKSPACE_FILE_CONTENT_BYTES) {
      throw new OrchestrationError(
        'payload_too_large',
        `File size exceeds ${MAX_WORKSPACE_FILE_CONTENT_BYTES / 1024 / 1024}MB limit`
      )
    }
    return updateAuthorizedWorkspaceFileContent({
      principal,
      input,
      content,
      canonical: context,
    })
  },
  projectAudit: ({ result }) => projectUpdateWorkspaceFileContentAudit(result),
})

export const updateWorkspaceFileContentFromBuffer = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.updateContent,
  resolveContext: ({ input }: { input: UpdateWorkspaceFileContentBufferInput }) =>
    resolveActiveWorkspaceFileContext(input),
  execute: ({ principal, input, context }) =>
    updateAuthorizedWorkspaceFileContent({
      principal,
      input,
      content: input.content,
      canonical: context,
    }),
  projectAudit: ({ result }) => projectUpdateWorkspaceFileContentAudit(result),
})
