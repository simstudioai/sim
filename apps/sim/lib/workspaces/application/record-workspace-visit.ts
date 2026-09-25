import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import { recordWorkspaceVisitRecord } from '@/lib/workspaces/visits'

export const workspaceVisitOperations = {
  /** permission-group-exempt: records the caller's own navigation into a workspace they can already read; it grants and discloses nothing */
  record: defineWorkspaceOperation({
    id: 'workspaces.visits.record',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['session'],
  }),
} as const

interface RecordWorkspaceVisitInput {
  workspaceId: string
}

/** Records that the signed-in user opened a workspace they can access. */
export const recordWorkspaceVisit = defineAuthorizedWorkspaceUseCase({
  operation: workspaceVisitOperations.record,
  resolveContext: ({ input }: { input: RecordWorkspaceVisitInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  execute: ({ principal, context }) =>
    recordWorkspaceVisitRecord(principal.userId, context.workspaceId),
})
