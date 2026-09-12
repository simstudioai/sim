/** @vitest-environment node */
import { generateKeyPairSync, verify } from 'node:crypto'
import { inputValidationMock, resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertGitHubInstallationActive,
  assertGitHubInstallationRepositoryActive,
  getGitHubInstallationConfiguration,
  listGitHubInstallationRepositories,
  listUserAdminGitHubInstallations,
  parseGitHubInstallationBinding,
  resolveGitHubInstallationAccessToken,
  resolveGitHubInstallationRepository,
  verifyGitHubInstallationBinding,
} from '@/lib/oauth/github-installation'
import type { GitHubInstallationBinding } from '@/lib/oauth/github-installation-types'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const user = { id: 9, type: 'User' }
const installation = {
  id: 21,
  app_id: 1,
  client_id: 'Iv123',
  account: { id: 11, login: 'team', type: 'Organization' },
  repository_selection: 'selected',
  permissions: { contents: 'read', metadata: 'read' },
  suspended_at: null,
}
const membership = { state: 'active', role: 'admin', organization: { id: 11 }, user: { id: 9 } }
const binding: GitHubInstallationBinding = {
  type: 'github_app_installation',
  version: 1,
  appId: '1',
  appClientId: 'Iv123',
  installationId: '21',
  accountId: '11',
  accountType: 'Organization',
  accountLogin: 'team',
  repositorySelection: 'selected',
}
let now = Date.UTC(2026, 8, 9)
const fetchMock = vi.fn<typeof fetch>()

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}

function tokenResponse(repositoryId = 101, contents = true) {
  return {
    token: contents ? 'ghs_contents' : 'ghs_metadata',
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    permissions: { metadata: 'read', ...(contents ? { contents: 'read' } : {}) },
    repositories: [{ id: repositoryId }],
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  now += 86_400_000
  vi.setSystemTime(now)
  setEnv({
    GITHUB_APP_ID: '1',
    GITHUB_APP_CLIENT_ID: 'Iv123',
    GITHUB_APP_CLIENT_SECRET: 'secret',
    GITHUB_APP_PRIVATE_KEY: privateKeyPem,
    GITHUB_APP_SLUG: 'sim-search',
  })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  resetEnvMock()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function mockDiscovery(
  installs: unknown[] = [installation],
  memberships: unknown[] = [membership]
) {
  fetchMock.mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname
    if (path === '/user') return json(user)
    if (path === '/user/memberships/orgs') return json(memberships)
    if (path === '/user/installations')
      return json({ total_count: installs.length, installations: installs })
    if (path === '/app/installations/21') return json(installation)
    throw new Error(`Unexpected request: ${path}`)
  })
}

describe('GitHub installation setup', () => {
  it('reports the failing token operation without including provider response contents', async () => {
    fetchMock
      .mockResolvedValueOnce(json(installation))
      .mockResolvedValueOnce(json({ message: 'sensitive provider detail' }, 422))
    await expect(
      resolveGitHubInstallationAccessToken(binding, { repositoryId: '101' })
    ).rejects.toMatchObject({
      operation: 'repository-token',
      status: 422,
      message:
        'Check that the repository is included in the selected GitHub App installation, then retry.',
    })
  })
  it('lists one metadata-only repository page with continuation and account checks', async () => {
    fetchMock
      .mockResolvedValueOnce(json(installation))
      .mockResolvedValueOnce(json(tokenResponse(101, false)))
      .mockResolvedValueOnce(
        json({
          total_count: 201,
          repositories: Array.from({ length: 100 }, (_, i) => ({
            id: 101 + i,
            full_name: `team/repo-${i}`,
            owner: { id: 11 },
            default_branch: 'main',
          })),
        })
      )
    const controller = new AbortController()
    const result = await listGitHubInstallationRepositories(binding, {
      page: 2,
      signal: controller.signal,
    })
    expect(result.repositories).toHaveLength(100)
    expect(result.repositories[0]).toEqual({ id: '101', fullName: 'team/repo-0' })
    expect(result.hasMore).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      permissions: { metadata: 'read' },
    })
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://api.github.com/installation/repositories?per_page=100&page=2'
    )
    controller.abort()
    expect(fetchMock.mock.calls[2][1]?.signal?.aborted).toBe(true)
  })

  it.each([0, 101, 1.5, Number.NaN])(
    'rejects an invalid repository page %s before provider reads',
    async (page) => {
      await expect(listGitHubInstallationRepositories(binding, { page })).rejects.toThrow(
        'page is invalid'
      )
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('refuses a suspended installation before minting a listing token', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...installation, suspended_at: '2026-01-01T00:00:00Z' }))
    await expect(listGitHubInstallationRepositories(binding)).rejects.toThrow('unavailable')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects content permissions in repository browsing tokens', async () => {
    fetchMock.mockResolvedValueOnce(json(installation)).mockResolvedValueOnce(json(tokenResponse()))
    await expect(listGitHubInstallationRepositories(binding)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects repositories from another installation account', async () => {
    fetchMock
      .mockResolvedValueOnce(json(installation))
      .mockResolvedValueOnce(json(tokenResponse(101, false)))
      .mockResolvedValueOnce(
        json({
          total_count: 1,
          repositories: [
            { id: 101, full_name: 'other/repo', owner: { id: 12 }, default_branch: 'main' },
          ],
        })
      )
    await expect(listGitHubInstallationRepositories(binding)).rejects.toThrow(
      'another GitHub installation account'
    )
  })

  it('rechecks repository installation selection without caching a previous success', async () => {
    fetchMock
      .mockResolvedValueOnce(json(installation))
      .mockResolvedValueOnce(json({ message: 'Not Found' }, 404))
    await expect(
      assertGitHubInstallationRepositoryActive(binding, 'team/repo')
    ).resolves.toBeUndefined()
    await expect(assertGitHubInstallationRepositoryActive(binding, 'team/repo')).rejects.toThrow()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/team/repo/installation',
      'https://api.github.com/repos/team/repo/installation',
    ])
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('authorization')?.split('.')).toHaveLength(3)
  })

  it.each([
    { ...installation, id: 22 },
    { ...installation, app_id: 2 },
    { ...installation, client_id: 'another-app' },
    { ...installation, account: { ...installation.account, id: 12 } },
    { ...installation, suspended_at: '2026-01-01T00:00:00Z' },
    { ...installation, permissions: { metadata: 'read' } },
  ])('rejects a removed, suspended, or rebound repository installation %#', async (current) => {
    fetchMock.mockResolvedValueOnce(json(current))
    await expect(assertGitHubInstallationRepositoryActive(binding, 'team/repo')).rejects.toThrow(
      'unavailable or its account binding changed'
    )
  })

  it('requires a valid RSA app key and returns no credentials in readiness metadata', () => {
    expect(getGitHubInstallationConfiguration()).toEqual({
      configured: true,
      installUrl: 'https://github.com/apps/sim-search/installations/new',
    })
    setEnv({ GITHUB_APP_PRIVATE_KEY: 'invalid' })
    expect(getGitHubInstallationConfiguration()).toEqual({ configured: false, installUrl: null })
  })

  it('lists only owned personal accounts and active organization-owner installations', async () => {
    mockDiscovery([
      installation,
      { ...installation, id: 22, account: { id: 9, login: 'me', type: 'User' } },
      { ...installation, id: 23, account: { id: 10, login: 'other', type: 'User' } },
      {
        ...installation,
        id: 24,
        account: { id: 12, login: 'read-only-org', type: 'Organization' },
      },
      { ...installation, id: 25, suspended_at: '2026-01-01T00:00:00Z' },
      { ...installation, id: 26, app_id: 2 },
    ])
    expect(
      (await listUserAdminGitHubInstallations('ghu_user')).map((entry) => entry.installationId)
    ).toEqual(['21', '22'])
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/app/installations'))).toBe(
      false
    )
  })

  it('never treats read-visible installation membership as authority to bind', async () => {
    mockDiscovery([installation], [{ ...membership, role: 'member' }])
    await expect(verifyGitHubInstallationBinding('ghu_user', '21')).rejects.toThrow(
      'Only the GitHub account owner'
    )
  })

  it('rejects pending owners and provider identity mismatches', async () => {
    mockDiscovery([installation], [{ ...membership, state: 'pending' }])
    expect(await listUserAdminGitHubInstallations('ghu_user')).toEqual([])
    mockDiscovery([installation], [{ ...membership, user: { id: 99 } }])
    await expect(listUserAdminGitHubInstallations('ghu_user')).rejects.toThrow(
      'identity does not match'
    )
  })

  it('revalidates the chosen installation using a short-lived signed app JWT', async () => {
    mockDiscovery()
    expect(await verifyGitHubInstallationBinding('ghu_user', '21')).toEqual(binding)
    const appRequest = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/app/installations/21')
    )
    const token = new Headers(appRequest?.[1]?.headers).get('Authorization')?.slice(7) ?? ''
    const [header, payload, signature] = token.split('.')
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, 'base64url')
      )
    ).toBe(true)
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
      iat: now / 1000 - 60,
      exp: now / 1000 + 540,
      iss: 'Iv123',
    })
    expect(appRequest?.[1]?.redirect).toBe('error')
  })

  it('accepts GitHub responses omitting optional client_id, using verified app_id', async () => {
    const { client_id: _clientId, ...withoutClientId } = installation
    mockDiscovery([withoutClientId])
    expect((await listUserAdminGitHubInstallations('ghu_user'))[0].appClientId).toBe('Iv123')
  })

  it('fails closed when a listing reaches the explicit page cap', async () => {
    fetchMock.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname
      return path === '/user' ? json(user) : json(Array.from({ length: 100 }, () => membership))
    })
    await expect(listUserAdminGitHubInstallations('ghu_user')).rejects.toThrow('listing exceeds')
    expect(fetchMock).toHaveBeenCalledTimes(11)
  })

  it('rejects unsafe identifiers, unknown binding fields, and non-user tokens before network access', async () => {
    expect(() => parseGitHubInstallationBinding({ ...binding, privateKey: 'untrusted' })).toThrow(
      'invalid'
    )
    await expect(verifyGitHubInstallationBinding('ghu_user', '../21')).rejects.toThrow(
      'ID is invalid'
    )
    await expect(listUserAdminGitHubInstallations('ghs_installation')).rejects.toThrow(
      'Connect your GitHub account'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('GitHub installation content tokens', () => {
  it.each([
    { ...installation, suspended_at: '2026-01-01T00:00:00Z' },
    { ...installation, account: { ...installation.account, id: 99 } },
    { ...installation, app_id: 2 },
    { ...installation, client_id: 'wrong' },
    { ...installation, permissions: { metadata: 'read' } },
  ])('denies a suspended, moved, or incompatible installation', async (providerInstallation) => {
    fetchMock.mockResolvedValue(json(providerInstallation))
    await expect(assertGitHubInstallationActive(binding)).rejects.toThrow(
      'unavailable or its account binding changed'
    )
  })

  it('refuses cached bindings after changing the configured app', async () => {
    setEnv({ GITHUB_APP_ID: '2' })
    await expect(assertGitHubInstallationActive(binding)).rejects.toThrow(
      'different configured app'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('mints a token narrowed to one immutable repository with only read permissions', async () => {
    fetchMock.mockResolvedValueOnce(json(installation)).mockResolvedValueOnce(json(tokenResponse()))
    expect(await resolveGitHubInstallationAccessToken(binding, { repositoryId: '101' })).toEqual({
      accessToken: 'ghs_contents',
    })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      permissions: { contents: 'read', metadata: 'read' },
      repository_ids: [101],
    })
  })

  it('rechecks suspension before returning a cached token', async () => {
    fetchMock
      .mockResolvedValueOnce(json(installation))
      .mockResolvedValueOnce(json(tokenResponse()))
      .mockResolvedValueOnce(json({ ...installation, suspended_at: '2026-01-01T00:00:00Z' }))
    await resolveGitHubInstallationAccessToken(binding, { repositoryId: '101' })
    await expect(
      resolveGitHubInstallationAccessToken(binding, { repositoryId: '101' })
    ).rejects.toThrow('unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('refuses unscoped token resolution and widened provider token responses', async () => {
    await expect(resolveGitHubInstallationAccessToken(binding, {})).rejects.toThrow(
      'require a source repository'
    )
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock
      .mockResolvedValueOnce(json(installation))
      .mockResolvedValueOnce(
        json({ ...tokenResponse(), permissions: { contents: 'write', metadata: 'read' } })
      )
    await expect(
      resolveGitHubInstallationAccessToken(binding, { repositoryId: '101' })
    ).rejects.toThrow('invalid installation token scope')
  })

  it.each(['team/repo', ' https://github.com/team/repo.git/ '])(
    'resolves %s using repository-scoped metadata access and verifies its owner ID',
    async (repository) => {
      fetchMock
        .mockResolvedValueOnce(json(installation))
        .mockResolvedValueOnce(json(tokenResponse(101, false)))
        .mockResolvedValueOnce(
          json({ id: 101, full_name: 'team/repo', owner: { id: 11 }, default_branch: 'main' })
        )
      expect(await resolveGitHubInstallationRepository(binding, repository)).toEqual({
        id: '101',
        fullName: 'team/repo',
        defaultBranch: 'main',
      })
      expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
        permissions: { metadata: 'read' },
        repositories: ['repo'],
      })
      expect(fetchMock.mock.calls[2][0]).toBe('https://api.github.com/repos/team/repo')
      fetchMock
        .mockResolvedValueOnce(json(installation))
        .mockResolvedValueOnce(
          json({ id: 101, full_name: 'team/repo', owner: { id: 99 }, default_branch: 'main' })
        )
      await expect(resolveGitHubInstallationRepository(binding, 'team/repo')).rejects.toThrow(
        'another GitHub installation account'
      )
    }
  )

  it.each([
    'https://github.com@evil.example/team/repo',
    'https://github.com.evil.example/team/repo',
    'team/../repo',
    'team/repo?redirect=https://example.com',
  ])('rejects unsafe repository %s before minting a token', async (repository) => {
    await expect(resolveGitHubInstallationRepository(binding, repository)).rejects.toThrow(
      'owner/repo format'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects oversized provider payloads before parsing', async () => {
    fetchMock.mockResolvedValue(
      new Response('x', { headers: { 'content-length': String(3 * 1024 * 1024) } })
    )
    await expect(assertGitHubInstallationActive(binding)).rejects.toThrow()
  })
})
