/** @vitest-environment node */
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  membership: vi.fn(),
  section: vi.fn(),
  route: vi.fn(),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: vi.fn(async () => null),
}))
vi.mock('@/lib/settings/application/organization-section-access', () => ({
  authorizeOrganizationSettingsSection: mocks.section,
}))
vi.mock('@/lib/core/network/config.server', () => ({ resolveOutboundRoute: mocks.route }))

import { readOrganizationNetwork } from '@/lib/core/network/application/read-organization-network'
import { OutboundRoutingError } from '@/lib/core/network/routing'

const principal: Principal = {
  kind: 'session',
  userId: 'user_example',
  sessionId: 'session_example',
}
const input = { organizationId: 'org_example' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.membership.mockResolvedValue([{ role: 'admin' }])
  mocks.section.mockResolvedValue(true)
  mocks.route.mockResolvedValue({ kind: 'direct' })
  const query = { from: vi.fn(), where: vi.fn(), limit: mocks.membership }
  query.from.mockReturnValue(query)
  query.where.mockReturnValue(query)
  vi.mocked(db.select).mockReturnValue(query as ReturnType<typeof db.select>)
})

describe('organization network settings', () => {
  it.each([[], [{ role: 'member' }]])('withholds routing from non-admins', async (rows) => {
    mocks.membership.mockResolvedValue(rows)
    await expect(readOrganizationNetwork.execute({ principal, input })).rejects.toThrow()
    expect(mocks.route).not.toHaveBeenCalled()
    expect(mocks.section).not.toHaveBeenCalled()
  })

  it('rejects workspace credentials before looking up the organization', async () => {
    const workspacePrincipal: Principal = {
      kind: 'workspace_api_key',
      workspaceId: 'workspace_example',
      apiKeyId: 'key_example',
    }
    await expect(
      readOrganizationNetwork.execute({ principal: workspacePrincipal, input })
    ).rejects.toThrow()
    expect(mocks.membership).not.toHaveBeenCalled()
    expect(mocks.route).not.toHaveBeenCalled()
  })

  it('checks the target organization entitlement before reading its network', async () => {
    mocks.section.mockResolvedValue(false)
    await expect(readOrganizationNetwork.execute({ principal, input })).rejects.toThrow(
      'Network settings are not available'
    )
    expect(mocks.route).not.toHaveBeenCalled()
    expect(mocks.section).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org_example', section: 'security' })
    )
  })

  it('projects only published addresses, never credentials or dial addresses', async () => {
    mocks.route.mockResolvedValue({
      kind: 'gateway',
      revision: 'revision_example',
      scopeKey: 'org_example',
      gateway: {
        id: 'gateway_example',
        url: 'https://private.example.invalid',
        token: 'synthetic-secret',
        ca: 'synthetic-ca',
        publicIps: ['192.0.2.10', '192.0.2.20'],
      },
    })
    await expect(readOrganizationNetwork.execute({ principal, input })).resolves.toEqual({
      mode: 'gateway',
      publicIps: ['192.0.2.10', '192.0.2.20'],
    })
    expect(mocks.route).toHaveBeenCalledWith('org_example')
  })

  it.each([
    ['ROUTE_BLOCKED', 'blocked'],
    ['CONFIGURATION_UNAVAILABLE', 'unavailable'],
    ['INVALID_CONFIGURATION', 'unavailable'],
  ] as const)('reports %s without claiming direct fallback', async (code, mode) => {
    mocks.route.mockRejectedValue(new OutboundRoutingError(code))
    await expect(readOrganizationNetwork.execute({ principal, input })).resolves.toEqual({ mode })
  })

  it('propagates unexpected failures instead of treating them as default routing', async () => {
    mocks.route.mockRejectedValue(new Error('unexpected failure'))
    await expect(readOrganizationNetwork.execute({ principal, input })).rejects.toThrow(
      'unexpected failure'
    )
  })
})
