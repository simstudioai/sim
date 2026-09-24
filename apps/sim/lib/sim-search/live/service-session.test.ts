/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import { createLiveServiceSession } from '@/lib/sim-search/live/service-session'
import type { NativeClient } from '@/lib/sim-search/live/types'

const mocks = vi.hoisted(() => ({
  source: vi.fn(),
  identity: vi.fn(),
  token: vi.fn(),
  client: vi.fn(),
  coda: vi.fn(),
  google: vi.fn(),
  github: vi.fn(),
  githubSources: vi.fn(),
}))
vi.mock('@/lib/knowledge/connectors/access-token', () => ({
  resolveConnectorTokenUserId: mocks.identity,
  resolveConnectorAccessToken: mocks.token,
}))
vi.mock('@/lib/sim-search/live/coda-service', () => ({ createCodaServiceVerifier: mocks.coda }))
vi.mock('@/lib/sim-search/live/google-service', () => ({
  createGoogleServiceVerifier: mocks.google,
}))
vi.mock('@/lib/sim-search/live/github-service', () => ({
  createGitHubServiceVerifier: mocks.github,
}))
vi.mock('@/lib/sim-search/live/service-sources', () => ({
  loadLiveServiceSource: mocks.source,
  loadLiveGitHubSources: mocks.githubSources,
}))
vi.mock('@/lib/sim-search/live/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sim-search/live/http')>()),
  createNativeClient: mocks.client,
}))
vi.mock('@/connectors/registry', () => ({
  CONNECTOR_META_REGISTRY: {
    coda: { mirrorsSourceAcls: true, auth: { mode: 'oauth', provider: 'coda' } },
    confluence: { mirrorsSourceAcls: true, auth: { mode: 'oauth', provider: 'confluence' } },
    google_drive: { mirrorsSourceAcls: true, auth: { mode: 'oauth', provider: 'google-drive' } },
    slack: { mirrorsSourceAcls: false },
  },
}))

const api = { json: vi.fn<NativeClient['json']>(), text: vi.fn() }
const source = {
  id: 'source',
  credentialId: 'service',
  encryptedApiKey: null,
  organizationId: 'org',
  config: {},
}
const base = {
  owner: { organizationId: 'org' },
  userId: 'reader',
  member: api,
  signal: new AbortController().signal,
}
const policy = {
  ...defaultLiveSearchPolicy(),
  accessMode: 'service_account' as const,
  sourceId: 'source',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.source.mockResolvedValue(source)
  mocks.identity.mockResolvedValue('credential-owner')
  mocks.token.mockResolvedValue({ accessToken: 'source-token' })
  mocks.client.mockReturnValue(api)
  mocks.coda.mockReturnValue(async () => true)
  mocks.githubSources.mockResolvedValue([{ id: 'repository-source' }])
  mocks.github.mockReturnValue({ policy, partial: false, verify: async () => true })
})

describe('service credential isolation', () => {
  it('does not load service credentials in member mode or for the dedicated GitLab flow', async () => {
    expect(
      await createLiveServiceSession({
        ...base,
        provider: 'coda',
        policy: defaultLiveSearchPolicy(),
      })
    ).toBeUndefined()
    expect(await createLiveServiceSession({ ...base, provider: 'gitlab', policy })).toBeUndefined()
    expect(mocks.source).not.toHaveBeenCalled()
    expect(mocks.token).not.toHaveBeenCalled()
  })
  it('resolves only the canonical source credential in its organization scope', async () => {
    await createLiveServiceSession({ ...base, provider: 'coda', policy })
    expect(mocks.source).toHaveBeenCalledWith(base.owner, 'coda', 'source')
    expect(mocks.identity).toHaveBeenCalledWith({
      credentialId: 'service',
      organizationId: 'org',
      fallbackUserId: 'reader',
    })
    expect(mocks.token).toHaveBeenCalledWith(
      expect.objectContaining({
        connector: source,
        userId: 'credential-owner',
        accessMode: 'admin',
      })
    )
    expect(mocks.client).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'https://coda.io', accessToken: 'source-token' })
    )
  })
  it('fails closed for missing source, invalid source credentials, and unsupported modes', async () => {
    await expect(
      createLiveServiceSession({
        ...base,
        provider: 'coda',
        policy: { ...policy, sourceId: undefined },
      })
    ).rejects.toThrow('select a service account source')
    mocks.identity.mockResolvedValue(null)
    await expect(createLiveServiceSession({ ...base, provider: 'coda', policy })).rejects.toThrow(
      'credential is unavailable'
    )
    expect(mocks.token).not.toHaveBeenCalled()
    await expect(createLiveServiceSession({ ...base, provider: 'slack', policy })).rejects.toThrow(
      'does not support'
    )
  })
  it('requires member Google credentials before delegating a Google source', async () => {
    await expect(
      createLiveServiceSession({ ...base, member: null, provider: 'google_drive', policy })
    ).rejects.toThrow('personal Google account')
    expect(mocks.google).not.toHaveBeenCalled()
  })
  it('builds GitHub App mode from the repository inventory and the member connection', async () => {
    const configured = { ...policy, sourceId: undefined }
    const session = await createLiveServiceSession({
      ...base,
      provider: 'github',
      policy: configured,
    })
    expect(session).toBeTruthy()
    expect(mocks.githubSources).toHaveBeenCalledWith(base.owner)
    expect(mocks.github).toHaveBeenCalledWith(
      [{ id: 'repository-source' }],
      api,
      base.signal,
      undefined
    )
    expect(mocks.source).not.toHaveBeenCalled()
    await expect(
      createLiveServiceSession({ ...base, member: null, provider: 'github', policy: configured })
    ).rejects.toThrow('personal GitHub account')
  })
  it('passes the caller connection pool to the GitHub verifier', async () => {
    const pool = { agent: vi.fn(), destroy: vi.fn() }
    await createLiveServiceSession({
      ...base,
      provider: 'github',
      policy: { ...policy, sourceId: undefined },
      pool,
    })
    expect(mocks.github).toHaveBeenCalledWith(expect.anything(), api, base.signal, pool)
  })
})

describe('Confluence source namespace', () => {
  beforeEach(() => {
    mocks.source.mockResolvedValue({
      ...source,
      config: {
        domain: 'company.atlassian.net',
        spaceKey: 'ENG',
        labelFilter: 'published',
        contentType: 'page',
      },
    })
    mocks.token.mockResolvedValue({
      accessToken: 'source-token',
      cloudId: 'cloud',
      domain: 'company.atlassian.net',
    })
    api.json.mockResolvedValue({
      id: 'page',
      status: 'current',
      type: 'page',
      space: { key: 'ENG' },
      metadata: { labels: { results: [{ name: 'published' }] } },
    })
  })
  it('requires the credential site and candidate cloud to match the configured source', async () => {
    const session = await createLiveServiceSession({ ...base, provider: 'confluence', policy })
    expect(await session!.verify({ id: 'page', container: 'other-cloud' })).toBe(false)
    expect(api.json).not.toHaveBeenCalled()
    expect(await session!.verify({ id: 'page', container: 'cloud' })).toBe(true)
    mocks.token.mockResolvedValue({
      accessToken: 'source-token',
      cloudId: 'cloud',
      domain: 'other.atlassian.net',
    })
    await expect(
      createLiveServiceSession({ ...base, provider: 'confluence', policy })
    ).rejects.toThrow('does not match')
  })
  it.each([
    { id: 'different' },
    { status: 'archived' },
    { space: { key: 'OTHER' } },
    { type: 'blogpost' },
    { metadata: { labels: { results: [] } } },
  ])('denies mismatched source metadata: %j', async (changed) => {
    api.json.mockResolvedValue({
      id: 'page',
      status: 'current',
      type: 'page',
      space: { key: 'ENG' },
      metadata: { labels: { results: [{ name: 'published' }] } },
      ...changed,
    })
    const session = await createLiveServiceSession({ ...base, provider: 'confluence', policy })
    expect(await session!.verify({ id: 'page', container: 'cloud' })).toBe(false)
  })
  it('preserves staging label alternatives instead of requiring every configured label', async () => {
    mocks.source.mockResolvedValue({
      ...source,
      config: {
        domain: 'company.atlassian.net',
        spaceKey: 'ENG',
        labelFilter: 'published, engineering',
      },
    })
    const session = await createLiveServiceSession({ ...base, provider: 'confluence', policy })
    expect(await session!.verify({ id: 'page', container: 'cloud' })).toBe(true)
  })
  it('scopes Confluence search to blog posts and alternative labels before a native sort clause', async () => {
    mocks.source.mockResolvedValue({
      ...source,
      config: {
        domain: 'company.atlassian.net',
        spaceKey: 'ENG',
        contentType: 'blogpost',
        labelFilter: 'published, engineering',
      },
    })
    const session = await createLiveServiceSession({ ...base, provider: 'confluence', policy })
    const scoped = session!.scopeSearch!({
      query: 'launch',
      limit: 10,
      scopes: [],
      native: { provider: 'confluence', query: 'text ~ "launch" ORDER BY lastmodified DESC' },
    })
    expect(scoped.native?.query).toContain('type = "blogpost"')
    expect(scoped.native?.query).toContain('label IN ("published", "engineering")')
    expect(scoped.native?.query).toMatch(/ORDER BY lastmodified DESC$/)
    expect(scoped.native?.query).not.toContain('label = "published" AND label = "engineering"')
  })
})
