import { createCopilotApplicationAdapter } from '@/lib/mothership/application/application-adapter'
import { projectFileOperations } from '@/lib/projects/files/application'
import { PROJECT_FILE_DELEGATION_TTL_MS } from '@/lib/projects/files/application/operations'

export const executeCopilotProjectFileUseCase = createCopilotApplicationAdapter({
  mode: 'resource',
  domain: 'project files',
  operations: projectFileOperations,
  projectResourceScope: (target: { projectId: string; fileId?: string }) => ({
    kind: 'entity',
    entityType: 'project',
    entityId: target.projectId,
    ...(target.fileId ? { fileId: target.fileId } : {}),
  }),
  delegation: {
    audience: projectFileOperations.list.delegationAudience,
    ttlMs: PROJECT_FILE_DELEGATION_TTL_MS,
    createDelegationId: (context) => context.toolCallId,
  },
})
