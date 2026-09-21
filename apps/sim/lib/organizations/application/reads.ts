import type { InvitationStatus } from '@sim/db/schema'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import {
  getOrganizationSeatAnalytics,
  getOrganizationSeatInfo,
} from '@/lib/billing/validation/seat-management'
import { defineAuthorizedOrganizationUseCase } from '@/lib/core/application/authorized-organization-use-case'
import { requireOAuthOperationScope } from '@/lib/core/application/oauth-authorization'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { PrincipalKindAuthorizationError } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { organizationOperations } from '@/lib/organizations/application/operations'
import {
  type OrganizationMemberPageInput,
  readOrganizationMemberPage,
} from '@/lib/organizations/member-queries'
import {
  listOrganizationInvitationRecords,
  listOrganizationRecordsForUser,
  listOrganizationWorkspaceRecords,
  type OrganizationInvitationSortBy,
  type OrganizationListOptions,
  type OrganizationSortBy,
  type OrganizationWorkspaceSortBy,
  organizationCursorKeys,
  requireOrganizationInvitationRecord,
  requireOrganizationRecord,
} from '@/lib/organizations/queries'
import { refuseCapability } from '@/lib/permission-groups/capabilities'
import { isOrganizationCapabilityWithheld } from '@/lib/permission-groups/capability-assertions'

export interface OrganizationInput {
  organizationId: string
}
export interface OrganizationInvitationInput extends OrganizationInput {
  invitationId: string
}

export const listOrganizations: OperationUseCase<
  typeof organizationOperations.list,
  OrganizationListOptions<OrganizationSortBy>,
  Awaited<ReturnType<typeof listOrganizationRecordsForUser>>
> = {
  operation: organizationOperations.list,
  async execute({ principal, input }) {
    if (
      principal.kind !== 'session' &&
      principal.kind !== 'personal_api_key' &&
      principal.kind !== 'oauth_access_token'
    )
      throw new PrincipalKindAuthorizationError(principal.kind, organizationOperations.list.id)
    requireOAuthOperationScope(principal, organizationOperations.list)
    const data: Awaited<ReturnType<typeof listOrganizationRecordsForUser>>['data'] = []
    let cursorKeys = input.cursorKeys
    do {
      const page = await listOrganizationRecordsForUser(principal.userId, { ...input, cursorKeys })
      for (const row of page.data) {
        try {
          const context = await authorizeOrganizationOperation(
            principal,
            organizationOperations.list,
            { organizationId: row.id }
          )
          data.push({ ...row, role: context.role })
          if (data.length > input.limit) {
            return {
              data: data.slice(0, input.limit),
              nextCursorKeys: organizationCursorKeys(data[input.limit - 1]!, input.sortBy),
            }
          }
        } catch (error) {
          if (
            !(error instanceof OrchestrationError) ||
            (error.code !== 'forbidden' && error.code !== 'not_found')
          )
            throw error
        }
      }
      cursorKeys = page.nextCursorKeys ?? undefined
    } while (cursorKeys)
    return { data, nextCursorKeys: null }
  },
}

export const getOrganization = defineAuthorizedOrganizationUseCase({
  operation: organizationOperations.read,
  async execute({
    input,
    context,
  }: {
    input: OrganizationInput & { includeSeats?: boolean }
    context: { role: string }
  }) {
    const organization = await requireOrganizationRecord(input.organizationId)
    const hasAdminAccess = isOrgAdminRole(context.role)
    const seats = input.includeSeats ? await getOrganizationSeatInfo(input.organizationId) : null
    const seatAnalytics =
      input.includeSeats && hasAdminAccess
        ? await getOrganizationSeatAnalytics(input.organizationId)
        : null
    return {
      ...organization,
      role: context.role,
      hasAdminAccess,
      ...(seats ? { seats } : {}),
      ...(seatAnalytics ? { seatAnalytics } : {}),
    }
  },
})

/** permission-group-enforced: organization.member_directory — administrators retain their member-management surface. */
export async function requireOrganizationMemberDirectory(organizationId: string, role: string) {
  if (
    !isOrgAdminRole(role) &&
    (await isOrganizationCapabilityWithheld(organizationId, 'organization.member_directory'))
  )
    refuseCapability('organization.member_directory')
}

export const listOrganizationMembers = defineAuthorizedOrganizationUseCase({
  operation: organizationOperations.listMembers,
  authorizeResource: ({ input, context }) =>
    requireOrganizationMemberDirectory(input.organizationId, context.role),
  async execute({
    input,
    context,
  }: {
    input: OrganizationInput & OrganizationMemberPageInput
    context: { role: string }
  }) {
    const hasAdminAccess = isOrgAdminRole(context.role)
    const page = await readOrganizationMemberPage(input.organizationId, {
      ...input,
      includeUsage: Boolean(input.includeUsage && hasAdminAccess),
    })
    return { ...page, userRole: context.role, hasAdminAccess }
  },
})

export const listOrganizationWorkspaces = defineAuthorizedOrganizationUseCase({
  operation: organizationOperations.listWorkspaces,
  execute: ({
    input,
  }: {
    input: OrganizationInput & OrganizationListOptions<OrganizationWorkspaceSortBy>
  }) => listOrganizationWorkspaceRecords(input.organizationId, input),
})

export const listOrganizationInvitations = defineAuthorizedOrganizationUseCase({
  operation: organizationOperations.listInvitations,
  execute: ({
    input,
  }: {
    input: OrganizationInput &
      OrganizationListOptions<OrganizationInvitationSortBy> & { status?: InvitationStatus }
  }) => listOrganizationInvitationRecords(input.organizationId, input),
})

export const getOrganizationInvitation = defineAuthorizedOrganizationUseCase({
  operation: organizationOperations.readInvitation,
  execute: ({ input }: { input: OrganizationInvitationInput }) =>
    requireOrganizationInvitationRecord(input.organizationId, input.invitationId),
})
