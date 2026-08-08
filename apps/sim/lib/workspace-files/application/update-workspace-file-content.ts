import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import {
  type Principal,
  resolvePrincipalAttribution,
  resolvePrincipalAuditAttribution,
} from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  ContentVersionConflictError,
  updateWorkspaceFileContent as updateStoredWorkspaceFileContent,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import {
  EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { loadAuthorizedWorkspaceFile } from '@/lib/workspace-files/application/load-authorized-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'
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
}

export interface UpdateWorkspaceFileContentResult {
  file: WorkspaceFileRecord
}

export interface UpdateWorkspaceFileContentBufferInput
  extends Omit<UpdateWorkspaceFileContentInput, 'content' | 'encoding'> {
  content: Buffer
}

interface UpdateWorkspaceFileContentArguments {
  principal: Principal
  input: UpdateWorkspaceFileContentInput
  request?: OrchestrationRequestContext
}

interface UpdateWorkspaceFileContentBufferArguments {
  principal: Principal
  input: UpdateWorkspaceFileContentBufferInput
  request?: OrchestrationRequestContext
}

async function admitUpdateWorkspaceFileContent(
  principal: Principal,
  fileId: string
): Promise<void> {
  await loadAuthorizedWorkspaceFile({
    principal,
    operation: fileOperations.updateContent,
    fileId,
  })
}

async function executeUpdateWorkspaceFileContent({
  principal,
  input,
  request,
}: UpdateWorkspaceFileContentArguments): Promise<UpdateWorkspaceFileContentResult> {
  const canonical = await loadAuthorizedWorkspaceFile({
    principal,
    operation: fileOperations.updateContent,
    fileId: input.fileId,
    assertedWorkspaceId: input.assertedWorkspaceId,
  })
  const content = Buffer.from(input.content, input.encoding === 'base64' ? 'base64' : 'utf-8')
  if (content.length > MAX_WORKSPACE_FILE_CONTENT_BYTES) {
    throw new OrchestrationError(
      'payload_too_large',
      `File size exceeds ${MAX_WORKSPACE_FILE_CONTENT_BYTES / 1024 / 1024}MB limit`
    )
  }

  return updateAuthorizedWorkspaceFileContent({ principal, input, content, request, canonical })
}

async function executeUpdateWorkspaceFileContentBuffer({
  principal,
  input,
  request,
}: UpdateWorkspaceFileContentBufferArguments): Promise<UpdateWorkspaceFileContentResult> {
  const canonical = await loadAuthorizedWorkspaceFile({
    principal,
    operation: fileOperations.updateContent,
    fileId: input.fileId,
    assertedWorkspaceId: input.assertedWorkspaceId,
  })
  return updateAuthorizedWorkspaceFileContent({
    principal,
    input,
    content: input.content,
    request,
    canonical,
  })
}

async function updateAuthorizedWorkspaceFileContent({
  principal,
  input,
  content,
  request,
  canonical,
}: {
  principal: Principal
  input: Omit<UpdateWorkspaceFileContentInput, 'content' | 'encoding'>
  content: Buffer
  request?: OrchestrationRequestContext
  canonical: Awaited<ReturnType<typeof loadAuthorizedWorkspaceFile>>
}): Promise<UpdateWorkspaceFileContentResult> {
  const attribution = resolvePrincipalAttribution(principal, {
    workspaceBillingOwnerUserId: canonical.billedAccountUserId,
  })
  const auditAttribution = resolvePrincipalAuditAttribution(principal)

  let file: WorkspaceFileRecord
  try {
    file = await updateStoredWorkspaceFileContent(
      canonical.workspaceId,
      canonical.fileId,
      attribution.attributedUserId,
      content,
      input.contentType,
      {
        ...(input.expectedUpdatedAt ? { expectedUpdatedAt: input.expectedUpdatedAt } : {}),
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
  recordAudit({
    workspaceId: canonical.workspaceId,
    actorId: auditAttribution.actorId,
    actorName: auditAttribution.actorName,
    action: AuditAction.FILE_UPDATED,
    resourceType: AuditResourceType.FILE,
    resourceId: file.id,
    resourceName: file.name,
    description: `Updated content of file "${file.name}"`,
    metadata: {
      operation: fileOperations.updateContent.id,
      actor: auditAttribution.actor,
      contentSize: content.length,
    },
    request,
  })

  return { file }
}

export const updateWorkspaceFileContent = {
  operation: fileOperations.updateContent,
  admit: admitUpdateWorkspaceFileContent,
  execute: executeUpdateWorkspaceFileContent,
} as const

export const updateWorkspaceFileContentFromBuffer = {
  operation: fileOperations.updateContent,
  execute: executeUpdateWorkspaceFileContentBuffer,
} as const
