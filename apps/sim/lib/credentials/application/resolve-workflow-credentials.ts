import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { defineAuthorizedWorkspaceUseCase, defineWorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  CREDENTIAL_GROUP_DELEGATION_AUDIENCE,
  requireCredentialGroupWorkflowActor,
} from '@/lib/credential-groups/application/authorization'
import { resolveCredentialGroupWorkspaceContext } from '@/lib/credential-groups/application/context'

interface ResolveWorkflowCredentialsInput {
  workspaceId: string
  credentialId?: string
  providerIds?: string[]
}

/** Resolves workspace credential references under the current workflow's authorization. */
export const resolveWorkflowCredentials = defineAuthorizedWorkspaceUseCase({
  /**
   * permission-group-exempt: Reference selection preserves workspace workflow access; token use enforces credential permissions.
   */
  operation: defineWorkspaceOperation({
    id: 'credentials.workflow_references.resolve',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'none',
    principalKinds: ['delegated'],
    delegatedServices: ['executor'],
  }),
  resolveContext: ({ input }: { input: ResolveWorkflowCredentialsInput }) =>
    resolveCredentialGroupWorkspaceContext(input.workspaceId),
  authorizationOptions: {
    delegation: {
      audience: CREDENTIAL_GROUP_DELEGATION_AUDIENCE,
      isWithinScope: (principal) => principal.resourceScope === undefined,
    },
  },
  authorizeResource: ({ principal }) => {
    requireCredentialGroupWorkflowActor(principal)
  },
  execute: async ({ input, context }) => {
    const records = await db.query.credential.findMany({
      where: and(
        eq(credential.workspaceId, context.workspaceId),
        eq(credential.type, 'oauth'),
        input.credentialId ? eq(credential.id, input.credentialId) : undefined,
        input.providerIds?.length ? inArray(credential.providerId, input.providerIds) : undefined
      ),
      columns: { id: true, displayName: true, providerId: true },
      orderBy: [asc(credential.displayName)],
    })
    if (input.credentialId && records.length !== 1)
      throw new OrchestrationError('not_found', 'Credential not found in this workspace')
    return records.map((record) => {
      if (!record.providerId)
        throw new Error(`OAuth credential ${record.id} is missing its provider`)
      return {
        credentialId: record.id,
        displayName: record.displayName,
        providerId: record.providerId,
      }
    })
  },
})
