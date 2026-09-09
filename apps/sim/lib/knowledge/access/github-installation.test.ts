/** @vitest-environment node */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GITHUB_READ_CONCURRENCY,
  GITHUB_READ_RESPONSE_MAX_BYTES,
  GITHUB_READ_SOURCE_LIMIT,
  resolveGitHubInstallationReadGrants,
} from '@/lib/knowledge/access/github-installation'

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  installation: vi.fn(),
  repositoryInstallation: vi.fn(),
  decrypt: vi.fn(),
  fetch: vi.fn(),
}))
vi.mock('@/lib/credentials/managed-oauth', () => ({ resolveManagedOAuthToken: mocks.token }))
vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: mocks.decrypt }))
vi.mock('@/lib/oauth/github-installation', () => ({
  parseGitHubInstallationBinding: (value: unknown) => value,
  assertGitHubInstallationActive: mocks.installation,
  assertGitHubInstallationRepositoryActive: mocks.repositoryInstallation,
}))

const input = {
  scope: { kind: 'organization' as const, organizationId: 'org-1' },
  readers: [{ credentialId: 'alice-credential', subjectToken: 's:github-repositories:-:alice' }],
  knowledgeBaseIds: ['index-1'],
}
const source = {
  connectorId: 'source-1',
  contentCredentialId: 'installation-credential',
  memberCredentialId: 'alice-credential',
  subjectToken: 's:github-repositories:-:alice',
  repository: 'company/private',
  repositoryId: '123',
  branch: null as string | null,
}
const binding = { installationId: '42', accountId: '90' }
const contentCredential = {
  id: 'installation-credential',
  key: 'encrypted-installation',
  installationId: '42',
  accountId: '90',
}
const grant = {
  connectorId: source.connectorId,
  contentCredentialId: source.contentCredentialId,
  readerCredentialId: source.memberCredentialId,
  readerSubjectToken: source.subjectToken,
  repositoryId: source.repositoryId,
}
const metadata = { id: 123, owner: { id: 90 }, default_branch: 'main' }
const reference = { ref: 'refs/heads/main', object: { type: 'commit', sha: 'a'.repeat(40) } }

function queueSources(rows: (typeof source)[] = [source]) {
  queueTableRows(schemaMock.knowledgeConnector, rows)
  queueTableRows(schemaMock.credential, [contentCredential])
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.token.mockResolvedValue({ accessToken: 'ghu_alice' })
  mocks.installation.mockResolvedValue(binding)
  mocks.repositoryInstallation.mockResolvedValue(undefined)
  mocks.decrypt.mockResolvedValue({ decrypted: JSON.stringify(binding) })
  mocks.fetch.mockImplementation(async (url: string) =>
    Response.json(url.includes('/git/ref/') ? reference : metadata)
  )
})

describe('live GitHub installation reader access', () => {
  it('requires both current installation and personal Contents access for the immutable repository', async () => {
    queueSources()
    await expect(resolveGitHubInstallationReadGrants(input)).resolves.toEqual([grant])
    expect(mocks.token).toHaveBeenCalledWith({
      credentialId: 'alice-credential',
      organizationId: 'org-1',
      expectedProviderId: 'github-repositories',
      requiredScopes: [],
    })
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/company/private',
      'https://api.github.com/repos/company/private/git/ref/heads/main',
    ])
    for (const [, init] of mocks.fetch.mock.calls)
      expect(init).toMatchObject({
        headers: { Authorization: 'Bearer ghu_alice' },
        cache: 'no-store',
        redirect: 'error',
      })
  })

  it('does not reuse a positive check after upstream access is revoked without a sync', async () => {
    queueSources()
    await expect(resolveGitHubInstallationReadGrants(input)).resolves.toEqual([grant])
    queueSources()
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(resolveGitHubInstallationReadGrants(input)).resolves.toEqual([])
    expect(mocks.installation).toHaveBeenCalledTimes(2)
    expect(mocks.token).toHaveBeenCalledTimes(2)
  })

  it('denies a public repository removed from the app installation even if the user could read it', async () => {
    queueSources()
    mocks.repositoryInstallation.mockRejectedValue(new Error('Repository installation not found'))
    mocks.fetch.mockResolvedValue(Response.json({ ...metadata, private: false }))
    await expect(resolveGitHubInstallationReadGrants(input)).resolves.toEqual([])
    expect(mocks.repositoryInstallation).toHaveBeenCalledWith(binding, source.repository, {
      signal: expect.any(AbortSignal),
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each([401, 403, 404, 429, 500, 503])(
    'denies a %i response rather than trusting stored observations',
    async (status) => {
      queueSources()
      mocks.fetch.mockResolvedValueOnce(new Response(null, { status }))
      await expect(resolveGitHubInstallationReadGrants(input)).resolves.toEqual([])
    }
  )

  it('denies metadata-only access even when repository lookup succeeds', async () => {
    queueSources()
    mocks.fetch
      .mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
    await expect(resolveGitHubInstallationReadGrants(input)).resolves.toEqual([])
  })

  it.each([
    { ...metadata, id: 456 },
    { ...metadata, owner: { id: 91 } },
    { ...metadata, default_branch: null },
  ])(
    'denies changed repository or account identity and incomplete provider data',
    async (response) => {
      queueSources()
      mocks.fetch.mockResolvedValueOnce(Response.json(response))
      await expect(resolveGitHubInstallationReadGrants(input)).resolves.toEqual([])
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    }
  )

  it('never uses the installer token or another enrolled person as a fallback', async () => {
    queueSources([{ ...source, subjectToken: 's:github-repositories:-:bob' }])
    await expect(resolveGitHubInstallationReadGrants(input)).resolves.toEqual([])
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('denies a reader who never connected without resolving an installation', async () => {
    await expect(resolveGitHubInstallationReadGrants({ ...input, readers: [] })).resolves.toEqual(
      []
    )
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mocks.installation).not.toHaveBeenCalled()
  })

  it('denies suspended installations and mismatched stored bindings', async () => {
    queueSources()
    mocks.installation.mockRejectedValueOnce(new Error('suspended'))
    await expect(resolveGitHubInstallationReadGrants(input)).resolves.toEqual([])
    queueSources()
    mocks.decrypt.mockResolvedValueOnce({
      decrypted: JSON.stringify({ ...binding, accountId: '91' }),
    })
    await expect(resolveGitHubInstallationReadGrants(input)).resolves.toEqual([])
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('keeps an allowed repository when a different repository is denied', async () => {
    queueSources([
      source,
      { ...source, connectorId: 'source-2', repository: 'company/denied', repositoryId: '456' },
    ])
    mocks.fetch.mockImplementation(async (url: string) =>
      url.includes('/denied')
        ? new Response(null, { status: 404 })
        : Response.json(url.includes('/git/ref/') ? reference : metadata)
    )
    await expect(resolveGitHubInstallationReadGrants(input)).resolves.toEqual([grant])
    expect(mocks.installation).toHaveBeenCalledTimes(1)
    expect(mocks.token).toHaveBeenCalledTimes(1)
  })

  it('deduplicates identical repository checks only inside the current admission', async () => {
    queueSources([source, { ...source, connectorId: 'source-2' }])
    await expect(resolveGitHubInstallationReadGrants(input)).resolves.toHaveLength(2)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it('bounds sources before any provider request', async () => {
    queueSources(
      Array.from({ length: GITHUB_READ_SOURCE_LIMIT + 1 }, (_, index) => ({
        ...source,
        connectorId: `source-${index}`,
      }))
    )
    await expect(resolveGitHubInstallationReadGrants(input)).resolves.toEqual([])
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(GITHUB_READ_SOURCE_LIMIT + 1)
    expect(mocks.installation).not.toHaveBeenCalled()
  })

  it('bounds concurrent source checks and never buffers unbounded response bytes', async () => {
    queueSources(
      Array.from({ length: GITHUB_READ_CONCURRENCY + 2 }, (_, index) => ({
        ...source,
        connectorId: `source-${index}`,
        repository: `company/repo-${index}`,
      }))
    )
    let active = 0
    let peak = 0
    mocks.fetch.mockImplementation(async (url: string) => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return Response.json(url.includes('/git/ref/') ? reference : metadata)
    })
    await expect(resolveGitHubInstallationReadGrants(input)).resolves.toHaveLength(
      GITHUB_READ_CONCURRENCY + 2
    )
    expect(peak).toBeLessThanOrEqual(GITHUB_READ_CONCURRENCY)
    queueSources()
    mocks.fetch.mockResolvedValueOnce(new Response('x'.repeat(GITHUB_READ_RESPONSE_MAX_BYTES + 1)))
    await expect(resolveGitHubInstallationReadGrants(input)).resolves.toEqual([])
  })

  it('stops on cancellation while a credential refresh remains pending', async () => {
    queueSources()
    const controller = new AbortController()
    mocks.token.mockImplementation(() => {
      controller.abort(new Error('cancelled'))
      return new Promise(() => {})
    })
    await expect(
      resolveGitHubInstallationReadGrants({ ...input, signal: controller.signal })
    ).resolves.toEqual([])
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
