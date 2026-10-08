import { apiServerRoutesMock } from '@sim/testing/mocks/api-server-routes.mock'
import { mothershipHeadlessLifecycleMock } from '@sim/testing/mocks/mothership-headless-lifecycle.mock'
import { triggersMock } from '@sim/testing/mocks/triggers.mock'
import { expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => triggersMock)
vi.mock('@/lib/mothership/request/lifecycle/headless', () => mothershipHeadlessLifecycleMock)

const inventory = vi.hoisted(
  () => [] as Array<{ method: string; path: string; operation: string; audience: string | null }>
)
const builder = vi.hoisted(
  () =>
    (options: {
      contract: { method: string; path: string }
      operation: { id: string }
      useCase: { delegationAudience?: string }
    }) => {
      inventory.push({
        method: options.contract.method,
        path: options.contract.path,
        operation: options.operation.id,
        audience: options.useCase.delegationAudience ?? null,
      })
      return async () => new Response()
    }
)
vi.mock('@/lib/api/server/routes/v2-json-route', () => ({
  ...apiServerRoutesMock,
  defineV2JsonRoute: builder,
}))
vi.mock('@/lib/api/server/routes/v2-binary-route', () => ({
  ...apiServerRoutesMock,
  defineV2BinaryRoute: builder,
}))
vi.mock('@/lib/api/server/routes/v2-body-lifecycle-route', () => ({
  ...apiServerRoutesMock,
  defineV2BodyLifecycleRoute: builder,
}))

import { V2_ROUTES } from '@/lib/api/server/routes/v2-route-table.generated'

it('inventories private operation admission without executing route requests', async () => {
  for (const route of V2_ROUTES) await route.load()
  expect(inventory.length).toBeGreaterThan(200)
  /** Public organization and version-history operations require a direct caller. */
  expect(inventory.filter((route) => !route.audience)).toMatchInlineSnapshot(`
    [
      {
        "audience": null,
        "method": "GET",
        "operation": "credentials.members.list",
        "path": "/api/v2/credentials/[credentialId]/members",
      },
      {
        "audience": null,
        "method": "POST",
        "operation": "credentials.members.upsert",
        "path": "/api/v2/credentials/[credentialId]/members",
      },
      {
        "audience": null,
        "method": "DELETE",
        "operation": "credentials.members.remove",
        "path": "/api/v2/credentials/[credentialId]/members/[userId]",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "files.versions.list",
        "path": "/api/v2/files/[fileId]/versions",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "files.versions.read",
        "path": "/api/v2/files/[fileId]/versions/[version]",
      },
      {
        "audience": null,
        "method": "DELETE",
        "operation": "files.versions.delete",
        "path": "/api/v2/files/[fileId]/versions/[version]",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "files.versions.download",
        "path": "/api/v2/files/[fileId]/versions/[version]/content",
      },
      {
        "audience": null,
        "method": "POST",
        "operation": "files.versions.revert",
        "path": "/api/v2/files/[fileId]/versions/[version]/revert",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "files.versions.read_content",
        "path": "/api/v2/files/[fileId]/versions/[version]/text",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "meta.capabilities.read",
        "path": "/api/v2/meta",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "organizations.list",
        "path": "/api/v2/organizations",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "organizations.read",
        "path": "/api/v2/organizations/[organizationId]",
      },
      {
        "audience": null,
        "method": "POST",
        "operation": "access_requests.create",
        "path": "/api/v2/organizations/[organizationId]/access-requests",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "access_requests.list_organization",
        "path": "/api/v2/organizations/[organizationId]/access-requests",
      },
      {
        "audience": null,
        "method": "POST",
        "operation": "access_requests.cancel",
        "path": "/api/v2/organizations/[organizationId]/access-requests/[requestId]/cancel",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "access_requests.preview",
        "path": "/api/v2/organizations/[organizationId]/access-requests/[requestId]/preview",
      },
      {
        "audience": null,
        "method": "POST",
        "operation": "access_requests.resolve",
        "path": "/api/v2/organizations/[organizationId]/access-requests/[requestId]/resolve",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "access_requests.discover",
        "path": "/api/v2/organizations/[organizationId]/access-requests/discovery",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "access_requests.list_mine",
        "path": "/api/v2/organizations/[organizationId]/access-requests/mine",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "access_requests.get_settings",
        "path": "/api/v2/organizations/[organizationId]/access-requests/settings",
      },
      {
        "audience": null,
        "method": "PATCH",
        "operation": "access_requests.update_settings",
        "path": "/api/v2/organizations/[organizationId]/access-requests/settings",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "organizations.invitations.list",
        "path": "/api/v2/organizations/[organizationId]/invitations",
      },
      {
        "audience": null,
        "method": "POST",
        "operation": "organizations.invitations.create",
        "path": "/api/v2/organizations/[organizationId]/invitations",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "organizations.invitations.read",
        "path": "/api/v2/organizations/[organizationId]/invitations/[invitationId]",
      },
      {
        "audience": null,
        "method": "DELETE",
        "operation": "invitations.revoke",
        "path": "/api/v2/organizations/[organizationId]/invitations/[invitationId]",
      },
      {
        "audience": null,
        "method": "POST",
        "operation": "invitations.resend",
        "path": "/api/v2/organizations/[organizationId]/invitations/[invitationId]/resend",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "organizations.invitations.workspaces.list",
        "path": "/api/v2/organizations/[organizationId]/invitations/[invitationId]/workspaces",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "organizations.members.list",
        "path": "/api/v2/organizations/[organizationId]/members",
      },
      {
        "audience": null,
        "method": "PATCH",
        "operation": "organizations.members.update",
        "path": "/api/v2/organizations/[organizationId]/members/[userId]",
      },
      {
        "audience": null,
        "method": "DELETE",
        "operation": "organizations.members.remove",
        "path": "/api/v2/organizations/[organizationId]/members/[userId]",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "organization_member_usage_limits.read",
        "path": "/api/v2/organizations/[organizationId]/members/[userId]/usage-limit",
      },
      {
        "audience": null,
        "method": "PATCH",
        "operation": "organization_member_usage_limits.update",
        "path": "/api/v2/organizations/[organizationId]/members/[userId]/usage-limit",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "permission_groups.list",
        "path": "/api/v2/organizations/[organizationId]/permission-groups",
      },
      {
        "audience": null,
        "method": "POST",
        "operation": "permission_groups.create",
        "path": "/api/v2/organizations/[organizationId]/permission-groups",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "permission_groups.read",
        "path": "/api/v2/organizations/[organizationId]/permission-groups/[groupId]",
      },
      {
        "audience": null,
        "method": "PATCH",
        "operation": "permission_groups.update",
        "path": "/api/v2/organizations/[organizationId]/permission-groups/[groupId]",
      },
      {
        "audience": null,
        "method": "DELETE",
        "operation": "permission_groups.delete",
        "path": "/api/v2/organizations/[organizationId]/permission-groups/[groupId]",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "permission_groups.members.list",
        "path": "/api/v2/organizations/[organizationId]/permission-groups/[groupId]/members",
      },
      {
        "audience": null,
        "method": "POST",
        "operation": "permission_groups.members.add",
        "path": "/api/v2/organizations/[organizationId]/permission-groups/[groupId]/members",
      },
      {
        "audience": null,
        "method": "DELETE",
        "operation": "permission_groups.members.remove",
        "path": "/api/v2/organizations/[organizationId]/permission-groups/[groupId]/members/[userId]",
      },
      {
        "audience": null,
        "method": "POST",
        "operation": "permission_groups.members.bulk_add",
        "path": "/api/v2/organizations/[organizationId]/permission-groups/[groupId]/members/bulk",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "organization.sso.read_requirement",
        "path": "/api/v2/organizations/[organizationId]/sso/policy",
      },
      {
        "audience": null,
        "method": "PATCH",
        "operation": "organization.sso.set_requirement",
        "path": "/api/v2/organizations/[organizationId]/sso/policy",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "organization.sso.providers.list",
        "path": "/api/v2/organizations/[organizationId]/sso/providers",
      },
      {
        "audience": null,
        "method": "POST",
        "operation": "organization.sso.providers.save",
        "path": "/api/v2/organizations/[organizationId]/sso/providers",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "organization.sso.providers.list",
        "path": "/api/v2/organizations/[organizationId]/sso/providers/[providerId]",
      },
      {
        "audience": null,
        "method": "DELETE",
        "operation": "organization.sso.providers.delete",
        "path": "/api/v2/organizations/[organizationId]/sso/providers/[providerId]",
      },
      {
        "audience": null,
        "method": "POST",
        "operation": "organization.sso.set_primary_provider",
        "path": "/api/v2/organizations/[organizationId]/sso/providers/[providerId]/primary",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "organization_usage.breakdown.read",
        "path": "/api/v2/organizations/[organizationId]/usage/breakdown",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "organization_usage.events.list",
        "path": "/api/v2/organizations/[organizationId]/usage/events",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "organization_usage.summary.read",
        "path": "/api/v2/organizations/[organizationId]/usage/summary",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "organizations.workspaces.list",
        "path": "/api/v2/organizations/[organizationId]/workspaces",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "workspaces.list_public",
        "path": "/api/v2/workspaces",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "access_requests.list_mine",
        "path": "/api/v2/workspaces/[workspaceId]/access-requests",
      },
      {
        "audience": null,
        "method": "POST",
        "operation": "access_requests.create",
        "path": "/api/v2/workspaces/[workspaceId]/access-requests",
      },
      {
        "audience": null,
        "method": "POST",
        "operation": "access_requests.cancel",
        "path": "/api/v2/workspaces/[workspaceId]/access-requests/[requestId]/cancel",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "access_requests.discover",
        "path": "/api/v2/workspaces/[workspaceId]/access-requests/discovery",
      },
      {
        "audience": null,
        "method": "POST",
        "operation": "invitations.send_batch",
        "path": "/api/v2/workspaces/[workspaceId]/invitations",
      },
      {
        "audience": null,
        "method": "GET",
        "operation": "permission_groups.read_user_config",
        "path": "/api/v2/workspaces/[workspaceId]/permission-config",
      },
    ]
  `)
  expect(
    inventory.filter((route) => route.audience).every((route) => route.audience?.startsWith('sim:'))
  ).toBe(true)
}, 60000)
