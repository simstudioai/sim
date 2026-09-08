/** @vitest-environment node */
import type { SlackInstallationPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  installation: vi.fn(),
  credential: vi.fn(),
  availability: vi.fn(),
}))
vi.mock('@/lib/knowledge/application/slack-search/repository', () => ({
  findSlackSearchInstallation: mocks.installation,
  loadSlackSearchCredential: mocks.credential,
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireOrganizationSearchAvailable: mocks.availability,
}))

import { authorizeSlackSearchInstallation } from '@/lib/knowledge/application/slack-search/authorization'

const principal: SlackInstallationPrincipal = {
  kind: 'slack_installation',
  credentialId: 'cred1',
  credentialVersion: 'version1',
  appId: 'A1',
  teamId: 'T1',
  eventId: 'Ev1',
  receivedAt: new Date(),
}
const installation = {
  id: 'install1',
  organizationId: 'org1',
  credentialId: 'cred1',
  enabled: true,
  appId: 'A1',
  teamId: 'T1',
  credentialVersion: 'version1',
  revision: 'revision1',
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.installation.mockResolvedValue(installation)
  mocks.credential.mockResolvedValue({ version: 'version1', botToken: 'secret' })
  mocks.availability.mockResolvedValue(undefined)
})
describe('Slack Search installation authorization', () => {
  it('rejects human principals before protected lookup', async () => {
    await expect(
      authorizeSlackSearchInstallation({ kind: 'session', userId: 'u1', sessionId: 's1' })
    ).rejects.toThrow('authority')
    expect(mocks.installation).not.toHaveBeenCalled()
  })
  it.each([{ appId: 'A2' }, { teamId: 'T2' }, { credentialVersion: 'new-version' }])(
    'refuses an authenticated delivery for a different binding',
    async (change) => {
      await expect(authorizeSlackSearchInstallation({ ...principal, ...change })).rejects.toThrow(
        'binding'
      )
      expect(mocks.credential).not.toHaveBeenCalled()
    }
  )
  it('uses the canonical organization when resolving the bot credential', async () => {
    await expect(authorizeSlackSearchInstallation(principal)).resolves.toMatchObject({
      installation,
    })
    expect(mocks.credential).toHaveBeenCalledWith('cred1', 'org1')
  })
  it.each([null, { ...installation, enabled: false }])(
    'does no work for removed or disabled installations',
    async (current) => {
      mocks.installation.mockResolvedValue(current)
      await expect(authorizeSlackSearchInstallation(principal)).resolves.toBeNull()
      expect(mocks.credential).not.toHaveBeenCalled()
    }
  )
  it('invalidates jobs queued before a disable/re-enable cycle', async () => {
    await expect(
      authorizeSlackSearchInstallation(principal, {
        installationId: 'install1',
        revision: 'old-revision',
      })
    ).rejects.toThrow('binding')
  })
  it('rejects rotated credentials until they are revalidated', async () => {
    mocks.credential.mockResolvedValue({ version: 'version2' })
    await expect(authorizeSlackSearchInstallation(principal)).rejects.toThrow('revalidation')
  })
  it('fails closed on feature withdrawal or infrastructure failure', async () => {
    mocks.availability.mockRejectedValue(new Error('unavailable'))
    await expect(authorizeSlackSearchInstallation(principal)).rejects.toThrow('unavailable')
    expect(mocks.credential).not.toHaveBeenCalled()
  })
})
