import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import type { OperationUseCase } from '@/lib/core/application/operation'
import {
  authorizeOrganizationOperation,
  type OrganizationMembershipContext,
} from '@/lib/core/application/organization-authorization'
import {
  defineOrganizationOperation,
  type OrganizationOperation,
} from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { validateUpdateCredentialGroupInput } from '@/lib/credential-groups/application/validation'
import { loadScopedAccountsCredentialListContext } from '@/lib/credential-groups/credentials'
import { CredentialGroupEnrollmentError } from '@/lib/credential-groups/enrollments'
import { ManagedMcpConnectorError } from '@/lib/credential-groups/managed-mcp-service'
import { requireOrganizationAccountsSetup } from '@/lib/credential-groups/organization-setup'
import { listConfiguredCredentialGroupProviders } from '@/lib/credential-groups/provider-availability'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import { createViewerCredentialGroupEnrollment } from '@/lib/credential-groups/self-enrollment'
import {
  ensureWorkspaceAccountsGroup,
  getOrganizationAccountsGroup,
  updateCredentialGroup,
} from '@/lib/credential-groups/service'
import type {
  CredentialGroupOptionInput,
  UpdateCredentialGroupInput,
} from '@/lib/credential-groups/types'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'

export const organizationAccountOperations = {
  read: defineOrganizationOperation({
    id: 'organization_accounts.read',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'integrations.manage',
  }),
  ensure: defineOrganizationOperation({
    id: 'organization_accounts.ensure',
    minimumRole: 'admin',
    principalKinds: ['session'],
    capability: 'integrations.manage',
  }),
  update: defineOrganizationOperation({
    id: 'organization_accounts.update',
    minimumRole: 'admin',
    principalKinds: ['session'],
    capability: 'integrations.manage',
  }),
  connect: defineOrganizationOperation({
    id: 'organization_accounts.connect',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'integrations.manage',
  }),
} as const

interface OrganizationAccountsInput {
  organizationId: string
}

export function defineOrganizationAccountsUseCase<
  const O extends OrganizationOperation,
  I extends OrganizationAccountsInput,
  R,
>(definition: {
  operation: O
  execute(args: { input: I; context: OrganizationMembershipContext }): Promise<R>
  projectAudit?(
    result: NoInfer<R>
  ): { resourceId: string; resourceName: string; description: string } | null
  afterSuccess?(args: { result: NoInfer<R>; context: OrganizationMembershipContext }): Promise<void>
}): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    async execute({ principal, input, request }) {
      const context = await authorizeOrganizationOperation(principal, definition.operation, input)
      if (
        !(await isScopedCredentialGroupsAvailable({
          kind: 'organization',
          organizationId: context.organizationId,
        }))
      ) {
        throw new OrchestrationError('not_found', 'Connected accounts are not available')
      }
      if (definition.operation.id !== organizationAccountOperations.ensure.id) {
        const group = await loadScopedAccountsCredentialListContext({
          kind: 'organization',
          organizationId: context.organizationId,
        })
        if (group)
          await requireOrganizationAccountsSetup(context.organizationId, group.credentialGroupId)
      }
      const result = await definition.execute({ input, context }).catch((error: unknown) => {
        if (error instanceof ManagedMcpConnectorError)
          throw new OrchestrationError(
            error.code === 'bad_gateway' ? 'internal' : error.code,
            error.message
          )
        if (error instanceof CredentialGroupEnrollmentError)
          throw new OrchestrationError(
            error.status === 404
              ? 'not_found'
              : error.status === 409
                ? 'conflict'
                : error.status === 400
                  ? 'validation'
                  : 'internal',
            error.message
          )
        throw error
      })
      const audit = definition.projectAudit?.(result)
      if (audit)
        recordAudit({
          ...audit,
          actorId: context.userId,
          action: AuditAction.CREDENTIAL_GROUP_UPDATED,
          resourceType: AuditResourceType.CREDENTIAL_GROUP,
          metadata: { organizationId: context.organizationId },
          request,
        })
      await definition.afterSuccess?.({ result, context })
      return result
    },
  }
}

export const getOrganizationAccountsSettings = defineOrganizationAccountsUseCase({
  operation: organizationAccountOperations.read,
  async execute({ context }) {
    return {
      credentialGroup: await getOrganizationAccountsGroup(context.organizationId),
      availableProviders: listConfiguredCredentialGroupProviders(),
      canManage: context.role === 'owner' || context.role === 'admin',
      indexingAvailable: await isKnowledgeMemberAccessAvailable({
        organizationId: context.organizationId,
      }),
    }
  },
})

export const ensureOrganizationAccounts = defineOrganizationAccountsUseCase({
  operation: organizationAccountOperations.ensure,
  async execute({
    input,
    context,
  }: {
    input: OrganizationAccountsInput & { option?: CredentialGroupOptionInput }
    context: OrganizationMembershipContext
  }) {
    if (input.option) validateUpdateCredentialGroupInput({ options: [input.option] })
    const { created, ...credentialGroup } = await ensureWorkspaceAccountsGroup(
      { kind: 'organization', organizationId: context.organizationId },
      context.userId,
      input.option
    )
    return { credentialGroup, created }
  },
  projectAudit: ({ credentialGroup, created }) =>
    created
      ? {
          resourceId: credentialGroup.id,
          resourceName: credentialGroup.name,
          description: 'Set up connected accounts',
        }
      : null,
})

export const updateOrganizationAccountsSettings = defineOrganizationAccountsUseCase({
  operation: organizationAccountOperations.update,
  async execute({
    input,
    context,
  }: {
    input: OrganizationAccountsInput & {
      credentialGroupId: string
      update: UpdateCredentialGroupInput
    }
    context: OrganizationMembershipContext
  }) {
    const credentialGroup = await updateCredentialGroup(
      { kind: 'organization', organizationId: context.organizationId },
      input.credentialGroupId,
      validateUpdateCredentialGroupInput(input.update)
    )
    if (!credentialGroup) throw new OrchestrationError('not_found', 'Connected accounts not found')
    return { credentialGroup }
  },
  projectAudit: ({ credentialGroup }) => ({
    resourceId: credentialGroup.id,
    resourceName: credentialGroup.name,
    description: 'Updated connected accounts',
  }),
})

export const startOrganizationAccountConnection = defineOrganizationAccountsUseCase({
  operation: organizationAccountOperations.connect,
  async execute({
    input,
    context,
  }: {
    input: OrganizationAccountsInput & { optionId: string }
    context: OrganizationMembershipContext
  }) {
    const group = await getOrganizationAccountsGroup(context.organizationId)
    if (!group || group.status !== 'active')
      throw new OrchestrationError('not_found', 'Ask an organization admin to set up this source')
    if (
      !group.options.some((option) => option.id === input.optionId && option.status === 'active')
    ) {
      throw new OrchestrationError('not_found', 'This account option is no longer available')
    }
    const { invitationLink } = await createViewerCredentialGroupEnrollment({
      organizationId: context.organizationId,
      userId: context.userId,
      credentialGroupId: group.id,
    })
    const url = new URL(invitationLink)
    url.searchParams.set('optionId', input.optionId)
    url.searchParams.set('returnTo', 'search')
    return { invitationLink: url.toString() }
  },
})
