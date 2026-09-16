/** @vitest-environment node */
import { db } from '@sim/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ configuration: vi.fn(), credential: vi.fn(), limit: vi.fn() }))
vi.mock('@/lib/slack-search/app-configuration', () => ({
  loadSlackAppConfiguration: mocks.configuration,
}))
vi.mock('@/lib/knowledge/application/slack-search/repository', () => ({
  loadSlackSearchCredential: mocks.credential,
}))

import { resolveSlackAppInstallation } from '@/lib/knowledge/application/slack-search/ingress'

const principal = {
  kind: 'slack_app',
  appId: 'A1',
  appRevision: 'r1',
  receivedAt: new Date(),
} as const
const resolve = () => resolveSlackAppInstallation.execute({ principal, input: { teamId: 'T1' } })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.configuration.mockResolvedValue({
    app: { id: 'A1', revision: 'r1', kind: 'custom', organizationId: 'org1' },
  })
  mocks.credential.mockResolvedValue({ version: 'v1' })
  mocks.limit.mockResolvedValue([{ credentialId: 'c1', organizationId: 'org1' }])
  const query = { from: vi.fn(), where: vi.fn(), limit: mocks.limit }
  query.from.mockReturnValue(query)
  query.where.mockReturnValue(query)
  vi.mocked(db.select).mockReturnValue(query as ReturnType<typeof db.select>)
})

describe('verified Slack app routing', () => {
  it('resolves the stored organization credential after app verification', async () => {
    expect(await resolve()).toEqual({ credentialId: 'c1', credentialVersion: 'v1' })
    expect(mocks.credential).toHaveBeenCalledWith('c1', 'org1')
  })
  it('does not infer an installation for an unknown app/workspace pair', async () => {
    mocks.limit.mockResolvedValueOnce([])
    expect(await resolve()).toBeNull()
    expect(mocks.credential).not.toHaveBeenCalled()
  })
  it('rejects a custom app installation owned by a different organization', async () => {
    mocks.limit.mockResolvedValueOnce([{ credentialId: 'other', organizationId: 'other-org' }])
    await expect(resolve()).rejects.toThrow('ownership is inconsistent')
    expect(mocks.credential).not.toHaveBeenCalled()
  })
  it('supports an explicitly registered shared app with organization-specific installations', async () => {
    mocks.configuration.mockResolvedValueOnce({
      app: { id: 'A1', revision: 'r1', kind: 'shared', organizationId: null },
    })
    expect(await resolve()).toMatchObject({ credentialId: 'c1' })
  })
  it('rejects app-secret rotation between verification and routing', async () => {
    mocks.configuration.mockResolvedValueOnce({ app: { revision: 'rotated' } })
    await expect(resolve()).rejects.toThrow('configuration changed')
    expect(db.select).not.toHaveBeenCalled()
  })
  it('rejects expired app authority', async () => {
    await expect(
      resolveSlackAppInstallation.execute({
        principal: { ...principal, receivedAt: new Date(Date.now() - 61_000) },
        input: { teamId: 'T1' },
      })
    ).rejects.toThrow('authority is required')
    expect(mocks.configuration).not.toHaveBeenCalled()
  })
})
