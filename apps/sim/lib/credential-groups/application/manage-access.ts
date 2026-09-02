import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  requireCredentialGroupSettingsAvailable,
  resolveCredentialGroupSettingsContext,
} from '@/lib/credential-groups/application/context'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import {
  compileCredentialGroupWorkflowAccessPolicy,
  credentialGroupWorkflowAccessPolicyCodec,
  decodeCredentialGroupWorkflowAccessPolicy,
} from '@/lib/credential-groups/application/workflow-access-policy'
import {
  CREDENTIAL_GROUP_WORKFLOW_CATALOG_LIMIT,
  CREDENTIAL_GROUP_WORKFLOW_NAME_MAX_LENGTH,
} from '@/lib/credential-groups/limits'
import {
  ResourcePolicyRevisionConflictError,
  requireResourcePolicy,
  writeResourcePolicy,
} from '@/lib/resource-policies/repository'

interface CredentialGroupAccessTargetInput {
  assertedWorkspaceId: string
  credentialGroupId: string
}

export interface CredentialGroupWorkflowReference {
  id: string
  name: string
}

async function loadCredentialGroupWorkflowCatalog(
  workspaceId: string
): Promise<CredentialGroupWorkflowReference[]> {
  const rows = await db
    .select({
      id: workflow.id,
      name: sql<string>`left(${workflow.name}, ${CREDENTIAL_GROUP_WORKFLOW_NAME_MAX_LENGTH})`,
      nameLength: sql<number>`char_length(${workflow.name})`,
    })
    .from(workflow)
    .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
    .orderBy(asc(workflow.name), asc(workflow.id))
    .limit(CREDENTIAL_GROUP_WORKFLOW_CATALOG_LIMIT + 1)

  if (rows.length > CREDENTIAL_GROUP_WORKFLOW_CATALOG_LIMIT) {
    throw new Error(
      `Credential Group workflow catalog exceeds the ${CREDENTIAL_GROUP_WORKFLOW_CATALOG_LIMIT} row limit`
    )
  }
  return rows.map((row) => {
    if (!Number.isInteger(row.nameLength) || row.nameLength < 0) {
      throw new Error(`Workflow ${row.id} returned an invalid name length`)
    }
    if (row.nameLength > CREDENTIAL_GROUP_WORKFLOW_NAME_MAX_LENGTH) {
      throw new Error(
        `Workflow ${row.id} name exceeds the ${CREDENTIAL_GROUP_WORKFLOW_NAME_MAX_LENGTH} character limit`
      )
    }
    return { id: row.id, name: row.name }
  })
}

function requireAvailableWorkflows(
  allowedWorkflowIds: readonly string[],
  workflows: readonly CredentialGroupWorkflowReference[],
  error: 'stored' | 'input'
): void {
  const availableWorkflowIds = new Set(workflows.map((workflow) => workflow.id))
  for (const workflowId of allowedWorkflowIds) {
    if (availableWorkflowIds.has(workflowId)) continue
    if (error === 'input') {
      throw new OrchestrationError('validation', 'Policy workflow was not found')
    }
    throw new Error(
      `Credential Group workflow access references unavailable workflow ${workflowId}`
    )
  }
}

function presentPolicy(
  policy: Awaited<ReturnType<typeof requireResourcePolicy>>,
  credentialGroupId: string
): {
  revision: number
  allowedWorkflowIds: string[]
} {
  return {
    revision: policy.revision,
    allowedWorkflowIds: decodeCredentialGroupWorkflowAccessPolicy(
      policy.document,
      credentialGroupId
    ),
  }
}

export const readCredentialGroupAccess = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.readAccess,
  resolveContext: ({ input }: { input: CredentialGroupAccessTargetInput }) =>
    resolveCredentialGroupSettingsContext(input.credentialGroupId, input.assertedWorkspaceId),
  authorizationOptions: {},
  async execute({ context }) {
    await requireCredentialGroupSettingsAvailable(context.workspaceId)
    const policy = await requireResourcePolicy({
      workspaceId: context.workspaceId,
      resourceType: 'credential_group',
      resourceId: context.credentialGroupId,
      codec: credentialGroupWorkflowAccessPolicyCodec,
    })
    const access = presentPolicy(policy, context.credentialGroupId)
    const workflows = await loadCredentialGroupWorkflowCatalog(context.workspaceId)
    requireAvailableWorkflows(access.allowedWorkflowIds, workflows, 'stored')
    return {
      ...access,
      workflows,
    }
  },
})

export interface UpdateCredentialGroupAccessInput extends CredentialGroupAccessTargetInput {
  expectedRevision: number
  allowedWorkflowIds: string[]
}

export const updateCredentialGroupAccess = defineAuthorizedWorkspaceUseCase({
  operation: credentialGroupOperations.updateAccess,
  resolveContext: ({ input }: { input: UpdateCredentialGroupAccessInput }) =>
    resolveCredentialGroupSettingsContext(input.credentialGroupId, input.assertedWorkspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }) {
    await requireCredentialGroupSettingsAvailable(context.workspaceId)
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new OrchestrationError('validation', 'Expected policy revision must be positive')
    }
    const existingPolicy = await requireResourcePolicy({
      workspaceId: context.workspaceId,
      resourceType: 'credential_group',
      resourceId: context.credentialGroupId,
      codec: credentialGroupWorkflowAccessPolicyCodec,
    })
    if (existingPolicy.revision !== input.expectedRevision) {
      throw new OrchestrationError('conflict', new ResourcePolicyRevisionConflictError().message)
    }
    decodeCredentialGroupWorkflowAccessPolicy(existingPolicy.document, context.credentialGroupId)
    const document = compileCredentialGroupWorkflowAccessPolicy({
      credentialGroupId: context.credentialGroupId,
      allowedWorkflowIds: input.allowedWorkflowIds,
    })
    if (input.allowedWorkflowIds.length > 0) {
      const workflows = await loadCredentialGroupWorkflowCatalog(context.workspaceId)
      requireAvailableWorkflows(input.allowedWorkflowIds, workflows, 'input')
    }
    try {
      return presentPolicy(
        await writeResourcePolicy({
          workspaceId: context.workspaceId,
          resourceType: 'credential_group',
          resourceId: context.credentialGroupId,
          expectedRevision: input.expectedRevision,
          actorUserId: principal.userId,
          document,
          codec: credentialGroupWorkflowAccessPolicyCodec,
        }),
        context.credentialGroupId
      )
    } catch (error) {
      if (error instanceof ResourcePolicyRevisionConflictError) {
        throw new OrchestrationError('conflict', error.message)
      }
      throw error
    }
  },
  projectAudit: ({ result, context }) => ({
    action: AuditAction.CREDENTIAL_GROUP_UPDATED,
    resourceType: AuditResourceType.CREDENTIAL_GROUP,
    resourceId: context.credentialGroupId,
    resourceName: context.name,
    description: 'Updated Credential Group workflow access',
    metadata: {
      revision: result.revision,
      workflowCount: result.allowedWorkflowIds.length,
    },
  }),
})
