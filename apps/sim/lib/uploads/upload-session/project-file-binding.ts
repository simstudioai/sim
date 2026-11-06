import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { isRecordLike } from '@sim/utils/object'
import { requireResourceDelegation } from '@/lib/core/application/resource-delegation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PROJECT_FILE_DELEGATION_TTL_MS } from '@/lib/projects/files/application/operations'
import { PROJECT_FILE_UPLOAD_BINDING_KEY } from '@/lib/uploads/upload-session/types'

function credential(principal: Principal, projectId: string) {
  switch (principal.kind) {
    case 'session':
      return { kind: principal.kind, userId: principal.userId, sessionId: principal.sessionId }
    case 'personal_api_key':
      return { kind: principal.kind, userId: principal.userId, keyId: principal.keyId }
    case 'oauth_access_token':
      return { kind: principal.kind, userId: principal.userId, clientId: principal.clientId }
    case 'resource_delegated': {
      requireResourceDelegation(principal, {
        audience: 'sim:project-files',
        services: ['copilot'],
        scope: { kind: 'entity', entityType: 'project', entityId: projectId },
        maxTtlMs: PROJECT_FILE_DELEGATION_TTL_MS,
      })
      if (principal.serviceId !== 'copilot') break
      return {
        kind: principal.kind,
        serviceId: principal.serviceId,
        subjectUserId: principal.subjectUserId,
        audience: principal.audience,
        invocation: { ...principal.invocation },
      }
    }
  }
  throw new OrchestrationError('forbidden', 'This principal cannot control Project file uploads')
}

/** A receipt binds the actual credential and invocation; regenerated delegation IDs may retry. */
export function createProjectFileUploadBinding(principal: Principal, projectId: string) {
  return {
    version: 1 as const,
    entityType: 'project' as const,
    entityId: projectId,
    userId: requirePrincipalSubjectUserId(principal),
    principal: credential(principal, projectId),
  }
}

interface ProjectUploadSession {
  purpose: string
  workspaceId: string | null
  userId: string
  metadata: Record<string, unknown>
}

/** Project receipts have no legacy uploader-only authorization fallback. */
export function assertProjectFileUploadBinding(
  session: ProjectUploadSession,
  principal: Principal,
  projectId?: string
): string {
  const binding = session.metadata[PROJECT_FILE_UPLOAD_BINDING_KEY]
  if (
    session.purpose !== 'project_file' ||
    session.workspaceId !== null ||
    !isRecordLike(binding) ||
    binding.version !== 1 ||
    binding.entityType !== 'project' ||
    typeof binding.entityId !== 'string' ||
    !binding.entityId ||
    binding.userId !== session.userId ||
    (projectId !== undefined && projectId !== binding.entityId) ||
    !isRecordLike(binding.principal)
  )
    throw new OrchestrationError('not_found', 'Upload session not found')
  const expected = createProjectFileUploadBinding(principal, binding.entityId)
  const actual = binding.principal
  const matches =
    expected.userId === binding.userId &&
    Object.entries(expected.principal).every(([key, value]) => {
      if (key !== 'invocation') return actual[key] === value
      const invocation = actual.invocation
      if (!isRecordLike(invocation) || !isRecordLike(value)) return false
      return Object.entries(value).every(([field, entry]) => invocation[field] === entry)
    })
  if (!matches) throw new OrchestrationError('not_found', 'Upload session not found')
  return binding.entityId
}
