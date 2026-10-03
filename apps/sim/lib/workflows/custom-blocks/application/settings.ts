import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  CustomBlockValidationError,
  deleteCustomBlock,
  getCustomBlockManageContext,
  getCustomBlockUsageCounts,
  isCustomBlocksDeploymentEnabled,
  isCustomBlocksEligibleForOrganization,
  listCustomBlocksWithInputs,
  publishCustomBlock,
  updateCustomBlock,
} from '@/lib/workflows/custom-blocks/operations'
import {
  type PublishCustomBlockBody,
  publishCustomBlockBodySchema,
  type UpdateCustomBlockBody,
  updateCustomBlockBodySchema,
} from '@/lib/workflows/custom-blocks/settings-input'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

// permission-group-exempt: custom block settings retain source-workspace administration and deployment entitlement policy.
const base = {
  capability: 'none',
  workspaceApiKey: 'deny',
  principalKinds: ['session', 'delegated'],
  delegatedServices: ['copilot'],
} as const
export const customBlockSettingsOperations = {
  // permission-group-exempt: custom block settings retain source-workspace administration and deployment entitlement policy.
  list: defineWorkspaceOperation({
    ...base,
    id: 'custom_blocks.list',
    minimumRole: 'read',
    capability: 'none',
  }),
  // permission-group-exempt: custom block settings retain source-workspace administration and deployment entitlement policy.
  publish: defineWorkspaceOperation({
    ...base,
    id: 'custom_blocks.publish',
    minimumRole: 'admin',
    capability: 'none',
  }),
  // permission-group-exempt: custom block settings retain source-workspace administration and deployment entitlement policy.
  update: defineWorkspaceOperation({
    ...base,
    id: 'custom_blocks.update',
    minimumRole: 'admin',
    capability: 'none',
  }),
  // permission-group-exempt: custom block settings retain source-workspace administration and deployment entitlement policy.
  delete: defineWorkspaceOperation({
    ...base,
    id: 'custom_blocks.delete',
    minimumRole: 'admin',
    capability: 'none',
  }),
  // permission-group-exempt: custom block settings retain source-workspace administration and deployment entitlement policy.
  usages: defineWorkspaceOperation({
    ...base,
    id: 'custom_blocks.usages',
    minimumRole: 'admin',
    capability: 'none',
  }),
} as const
const authorizationOptions = { delegation: { audience: 'sim:settings', isWithinScope: () => true } }

async function mutateCustomBlock<T>(mutation: () => Promise<T>): Promise<T> {
  try {
    return await mutation()
  } catch (error) {
    if (error instanceof CustomBlockValidationError)
      throw new OrchestrationError('validation', error.message)
    throw error
  }
}

export interface CustomBlockManageInput {
  id: string
  workspaceId?: string
}
async function resolveManageContext({
  principal,
  input,
}: {
  principal: Principal
  input: CustomBlockManageInput
}) {
  if (principal.kind === 'delegated' && !input.workspaceId)
    throw new OrchestrationError('validation', 'workspaceId is required')
  const block = await getCustomBlockManageContext(input.id)
  if (!block) throw new OrchestrationError('not_found', 'Not found')
  if (!isCustomBlocksDeploymentEnabled())
    throw new OrchestrationError('forbidden', 'Custom blocks are not enabled for this organization')
  if (!block.sourceWorkspaceId)
    throw new OrchestrationError('forbidden', 'Admin permissions required')
  if (input.workspaceId && input.workspaceId !== block.sourceWorkspaceId)
    throw new OrchestrationError('forbidden', 'Custom block belongs to another source workspace')
  const context = await resolveActiveWorkspaceApplicationContext(block.sourceWorkspaceId)
  if (context.workspaceOrganizationId !== block.organizationId)
    throw new OrchestrationError('not_found', 'Not found')
  return { ...context, block }
}

export const listCustomBlockSettings = defineAuthorizedWorkspaceUseCase({
  operation: customBlockSettingsOperations.list,
  resolveContext: ({ input }: { input: { workspaceId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions,
  async execute({ context }) {
    const org = context.workspaceOrganizationId
    const enabled = Boolean(org && (await isCustomBlocksEligibleForOrganization(org)))
    return { enabled, customBlocks: enabled && org ? await listCustomBlocksWithInputs(org) : [] }
  },
})

export const publishCustomBlockSettings = defineAuthorizedWorkspaceUseCase({
  operation: customBlockSettingsOperations.publish,
  resolveContext: ({ input }: { input: PublishCustomBlockBody }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, context, input }) {
    const parsed = publishCustomBlockBodySchema.safeParse(input)
    if (!parsed.success) throw new OrchestrationError('validation', parsed.error.issues[0].message)
    const organizationId = context.workspaceOrganizationId
    if (!organizationId)
      throw new OrchestrationError(
        'validation',
        'Publishing a block requires the workspace to belong to an organization'
      )
    if (!(await isCustomBlocksEligibleForOrganization(organizationId)))
      throw new OrchestrationError(
        'forbidden',
        'Custom blocks are not enabled for this organization'
      )
    const customBlock = await mutateCustomBlock(() =>
      publishCustomBlock({
        ...parsed.data,
        workspaceId: context.workspaceId,
        organizationId,
        // actorless-unsupported: publishing requires a current human administrator; this operation admits only session or Copilot settings delegation.
        userId: requirePrincipalSubjectUserId(principal),
      })
    )
    return { customBlock }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.CUSTOM_BLOCK_PUBLISHED,
    resourceType: AuditResourceType.CUSTOM_BLOCK,
    resourceId: result.customBlock.id,
    resourceName: result.customBlock.name,
    description: `Published custom block "${result.customBlock.name}"`,
    metadata: {
      organizationId: result.customBlock.organizationId,
      type: result.customBlock.type,
      workflowId: result.customBlock.workflowId,
    },
  }),
})

export const updateCustomBlockSettings = defineAuthorizedWorkspaceUseCase({
  operation: customBlockSettingsOperations.update,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: CustomBlockManageInput & { patch: UpdateCustomBlockBody }
  }) => resolveManageContext({ principal, input }),
  authorizationOptions,
  async execute({ input }) {
    const parsed = updateCustomBlockBodySchema.safeParse(input.patch)
    if (!parsed.success) throw new OrchestrationError('validation', parsed.error.issues[0].message)
    await mutateCustomBlock(() => updateCustomBlock(input.id, parsed.data))
    return { success: true as const }
  },
  projectAudit: ({ input, context }) => ({
    action: AuditAction.CUSTOM_BLOCK_UPDATED,
    resourceType: AuditResourceType.CUSTOM_BLOCK,
    resourceId: input.id,
    resourceName: input.patch.name ?? context.block.name,
    description: `Updated custom block "${input.patch.name ?? context.block.name}"`,
    metadata: { organizationId: context.block.organizationId, type: context.block.type },
  }),
})

export const deleteCustomBlockSettings = defineAuthorizedWorkspaceUseCase({
  operation: customBlockSettingsOperations.delete,
  resolveContext: resolveManageContext,
  authorizationOptions,
  async execute({ input, context }) {
    const counts = await getCustomBlockUsageCounts(context.block.organizationId, context.block.type)
    await deleteCustomBlock(input.id)
    return { success: true as const, ...counts }
  },
  projectAudit: ({ input, context, result }) => ({
    action: AuditAction.CUSTOM_BLOCK_DELETED,
    resourceType: AuditResourceType.CUSTOM_BLOCK,
    resourceId: input.id,
    resourceName: context.block.name,
    description: `Unpublished custom block "${context.block.name}"`,
    metadata: {
      organizationId: context.block.organizationId,
      type: context.block.type,
      usageCount: result.usageCount,
      deployedUsageCount: result.deployedUsageCount,
    },
  }),
})

export const readCustomBlockUsages = defineAuthorizedWorkspaceUseCase({
  operation: customBlockSettingsOperations.usages,
  resolveContext: resolveManageContext,
  authorizationOptions,
  execute: ({ context }) =>
    getCustomBlockUsageCounts(context.block.organizationId, context.block.type),
})
