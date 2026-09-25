import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import {
  githubInstallationMock,
  githubInstallationMockFns,
} from '@sim/testing/mocks/github-installation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGitHubServiceVerifier } from '@/lib/sim-search/live/github-service'
import type { NativeClient } from '@/lib/sim-search/live/types'

const hoisted = vi.hoisted(() => ({
  appClient: vi.fn(),
}))
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/oauth/github-installation', () => githubInstallationMock)
vi.mock('@/lib/sim-search/live/http', async (original) => ({
  ...(await original<typeof import('@/lib/sim-search/live/http')>()),
  createNativeClient: hoisted.appClient,
}))

const mocks = {
  ...hoisted,
  active: githubInstallationMockFns.mockAssertGitHubInstallationRepositoryActive,
  token: githubInstallationMockFns.mockResolveGitHubInstallationAccessToken,
  parse: githubInstallationMockFns.mockParseGitHubInstallationBinding,
}

const source = {
  id: 'source',
  sourceConfig: {},
  credentialId: 'installation-credential',
  encryptedKey: 'encrypted-binding',
  installationId: '55',
  accountId: '99',
  config: {
    repository: 'acme/project',
    githubRepositoryId: '123',
    pathPrefix: 'docs/',
    extensions: '.md, txt',
  },
}
const repository = { id: 123, full_name: 'acme/project', owner: { id: 99 }, default_branch: 'main' }
const member: NativeClient = { json: vi.fn(), text: vi.fn() }
const app: NativeClient = { json: vi.fn(), text: vi.fn() }
const signal = new AbortController().signal

beforeEach(() => {
  encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: '{}' })
  mocks.parse.mockReturnValue({ installationId: '55', accountId: '99' })
  mocks.token.mockResolvedValue({ accessToken: 'installation-token' })
  mocks.appClient.mockReturnValue(app)
  vi.mocked(member.json).mockResolvedValue(repository)
  vi.mocked(app.json).mockResolvedValue(repository)
})

describe('GitHub App live repository boundary', () => {
  it('limits search to selected repositories and verifies both current identities', async () => {
    const verifier = createGitHubServiceVerifier([source], member, signal)
    expect(verifier.policy).toMatchObject({ mode: 'selected', included: ['acme/project'] })
    expect(await verifier.verify({ id: 'README.md', container: 'other/repo', kind: 'code' })).toBe(
      false
    )
    expect(
      await verifier.verify({ id: 'docs/README.md', container: 'ACME/PROJECT', kind: 'code' })
    ).toBe(true)
    expect(mocks.active).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: '55' }),
      'acme/project',
      { signal }
    )
    expect(mocks.token).toHaveBeenCalledWith(
      expect.any(Object),
      { repository: 'acme/project', repositoryId: '123' },
      { signal }
    )
    expect(member.json).toHaveBeenCalledWith('/repos/acme/project')
    expect(app.json).toHaveBeenCalledWith('/repos/acme/project')
    expect(
      await verifier.verify({ id: 'docs/second.md', container: 'acme/project', kind: 'code' })
    ).toBe(true)
    expect(member.json).toHaveBeenCalledOnce()
  })

  it('does not substitute default-branch code for a legacy non-default branch source', async () => {
    const verifier = createGitHubServiceVerifier(
      [{ ...source, config: { ...source.config, branch: 'release' } }],
      member,
      signal
    )
    expect(
      await verifier.verify({ id: 'docs/README.md', container: 'acme/project', kind: 'code' })
    ).toBe(false)
    expect(await verifier.verify({ id: '42', container: 'acme/project', kind: 'issues' })).toBe(
      true
    )
  })

  it('fails closed when the installed repository or member identity differs', async () => {
    vi.mocked(member.json).mockResolvedValue({ ...repository, id: 456 })
    expect(
      await createGitHubServiceVerifier([source], member, signal).verify({
        id: '42',
        container: 'acme/project',
        kind: 'issues',
      })
    ).toBe(false)
    vi.mocked(member.json).mockResolvedValue(repository)
    vi.mocked(app.json).mockResolvedValue({ ...repository, owner: { id: 100 } })
    expect(
      await createGitHubServiceVerifier([source], member, signal).verify({
        id: '42',
        container: 'acme/project',
        kind: 'issues',
      })
    ).toBe(false)
  })
})
