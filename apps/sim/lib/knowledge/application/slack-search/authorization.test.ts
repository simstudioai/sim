/** @vitest-environment node */
import type { SlackInstallationPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  installation: vi.fn(),
  credential: vi.fn(),
  availability: vi.fn(),
  replacement: vi.fn(),
}))
vi.mock('@/lib/knowledge/application/slack-search/repository', () => ({
  findSlackSearchInstallation: mocks.installation,
  loadSlackSearchCredential: mocks.credential,
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireOrganizationSearchAvailable: mocks.availability,
}))
vi.mock('@/lib/slack-search/shared-app', () => ({
  requireSlackSearchAppAvailable: vi.fn(),
  findSharedSlackSearchInstallation: mocks.replacement,
}))

import {
  authorizeSlackSearchInstallation,
  authorizeSlackSearchRedirect,
} from '@/lib/knowledge/application/slack-search/authorization'

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
  mocks.replacement.mockResolvedValue(null)
})

describe('retired Slack bot handoff authorization', () => {
  const replacement = {
    ...installation,
    id: 'shared-install',
    credentialId: 'shared-credential',
    appId: 'ASHARED',
    credentialVersion: 'shared-version',
  }
  beforeEach(() => {
    mocks.installation.mockResolvedValue({ ...installation, enabled: false })
    mocks.credential.mockImplementation(async (id) =>
      id === replacement.credentialId
        ? { appKind: 'shared', version: replacement.credentialVersion }
        : { appKind: 'custom', version: 'version1', botToken: 'custom-token' }
    )
    mocks.replacement.mockResolvedValue(replacement)
  })

  it('authorizes only a handoff to the active shared installation for the same owner and team', async () => {
    await expect(authorizeSlackSearchInstallation(principal)).resolves.toBeNull()
    await expect(authorizeSlackSearchRedirect(principal)).resolves.toMatchObject({
      installation: { id: 'install1', enabled: false },
      replacement,
      secret: { botToken: 'custom-token' },
    })
    expect(mocks.replacement).toHaveBeenCalledWith('org1')
    expect(mocks.credential).toHaveBeenLastCalledWith('shared-credential', 'org1')
  })

  it.each([null, { ...installation, enabled: true }])(
    'ignores missing or active old bots: %j',
    async (current) => {
      mocks.installation.mockResolvedValue(current)
      await expect(authorizeSlackSearchRedirect(principal)).resolves.toBeNull()
      expect(mocks.replacement).not.toHaveBeenCalled()
    }
  )

  it.each([
    null,
    { ...replacement, organizationId: 'another-org' },
    { ...replacement, teamId: 'TOTHER' },
    { ...replacement, appId: 'A1' },
  ])('ignores unavailable or mismatched replacements: %j', async (target) => {
    mocks.replacement.mockResolvedValue(target)
    await expect(authorizeSlackSearchRedirect(principal)).resolves.toBeNull()
    expect(mocks.credential).toHaveBeenCalledTimes(1)
  })

  it('does not redirect a disabled shared app', async () => {
    mocks.credential.mockResolvedValue({ appKind: 'shared', version: 'version1' })
    await expect(authorizeSlackSearchRedirect(principal)).resolves.toBeNull()
    expect(mocks.replacement).not.toHaveBeenCalled()
  })

  it.each([{ teamId: 'TOTHER' }, { appId: 'AOTHER' }, { credentialVersion: 'stale' }])(
    'rejects forged installation identity: %j',
    async (change) => {
      await expect(authorizeSlackSearchRedirect({ ...principal, ...change })).rejects.toThrow(
        'binding'
      )
      expect(mocks.replacement).not.toHaveBeenCalled()
    }
  )

  it('rejects old queued work after the installation changes', async () => {
    await expect(
      authorizeSlackSearchRedirect(principal, { installationId: 'install1', revision: 'old' })
    ).rejects.toThrow('binding')
    expect(mocks.replacement).not.toHaveBeenCalled()
  })

  it('rejects revoked Search access and replacement credential rotation', async () => {
    mocks.availability.mockRejectedValueOnce(new Error('Search disabled'))
    await expect(authorizeSlackSearchRedirect(principal)).rejects.toThrow('Search disabled')
    expect(mocks.credential).not.toHaveBeenCalled()
    mocks.credential.mockResolvedValueOnce({ appKind: 'custom', version: 'version1' })
    mocks.credential.mockResolvedValueOnce({ appKind: 'shared', version: 'rotated' })
    await expect(authorizeSlackSearchRedirect(principal)).rejects.toThrow('revalidation')
  })
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
