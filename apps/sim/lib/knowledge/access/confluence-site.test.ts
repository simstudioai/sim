/** @vitest-environment node */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONFLUENCE_READ_ATTEMPT_TIMEOUT_MS,
  CONFLUENCE_READ_CONCURRENCY,
  CONFLUENCE_READ_CREDENTIAL_ALTERNATIVES,
  CONFLUENCE_READ_RESPONSE_MAX_BYTES,
  CONFLUENCE_READ_TIMEOUT_MS,
  resolveConfluenceSiteReadGrants,
} from '@/lib/knowledge/access/confluence-site'
import { MAX_KNOWLEDGE_ACCESS_CANDIDATES } from '@/lib/knowledge/access/types'

const mocks = vi.hoisted(() => ({ token: vi.fn(), decrypt: vi.fn(), fetch: vi.fn() }))
vi.mock('@/lib/credentials/managed-oauth', () => ({ resolveManagedOAuthToken: mocks.token }))
vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: mocks.decrypt }))

const input = {
  scope: { kind: 'organization' as const, organizationId: 'org-1' },
  readers: [{ credentialId: 'alice-credential', subjectToken: 's:confluence:-:alice' }],
  knowledgeBaseIds: ['index-1'],
  connectorIds: ['source-1'],
}
const source = {
  connectorId: 'source-1',
  contentCredentialId: 'crawler-credential',
  readerCredentialId: 'alice-credential',
  providerSubjectId: 'alice',
  domain: 'company.atlassian.net',
}
const binding = {
  type: 'atlassian_service_account',
  cloudId: 'cloud-1',
  domain: source.domain,
  apiToken: 'crawler-token-must-never-authenticate-reader',
}
const contentCredential = { id: 'crawler-credential', key: 'encrypted-crawler' }
const grant = {
  connectorId: source.connectorId,
  contentCredentialId: source.contentCredentialId,
  readerCredentialId: source.readerCredentialId,
  readerSubjectToken: input.readers[0].subjectToken,
  domain: source.domain,
  cloudId: binding.cloudId,
}

function queueSources(rows = [source], credentials = [contentCredential]) {
  input.connectorIds = rows.map((row) => row.connectorId)
  queueTableRows(schemaMock.knowledgeConnector, rows)
  queueTableRows(schemaMock.credential, [
    ...new Map(
      rows.map((row) => [
        row.readerCredentialId,
        { id: row.readerCredentialId, providerSubjectId: row.providerSubjectId },
      ])
    ).values(),
  ])
  queueTableRows(schemaMock.credential, credentials)
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.token.mockResolvedValue({ accessToken: 'alice-oauth-token' })
  mocks.decrypt.mockResolvedValue({ decrypted: JSON.stringify(binding) })
  mocks.fetch.mockImplementation(async () => Response.json({ accountId: 'alice', type: 'known' }))
})
afterEach(() => vi.restoreAllMocks())

describe('current Confluence site access', () => {
  it('requires the actual reader’s Can use permission at the crawler’s immutable site', async () => {
    queueSources()
    await expect(resolveConfluenceSiteReadGrants(input)).resolves.toEqual([grant])
    expect(mocks.token).toHaveBeenCalledWith({
      credentialId: 'alice-credential',
      organizationId: 'org-1',
      expectedProviderId: 'confluence',
      requiredScopes: ['read:confluence-user'],
    })
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.atlassian.com/ex/confluence/cloud-1/wiki/rest/api/user/current',
      expect.objectContaining({
        headers: { Authorization: 'Bearer alice-oauth-token', Accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      })
    )
    expect(JSON.stringify(mocks.fetch.mock.calls)).not.toContain(binding.apiToken)
  })

  it('denies newly revoked site access even if a direct space grant remains indexed', async () => {
    queueSources()
    await expect(resolveConfluenceSiteReadGrants(input)).resolves.toEqual([grant])
    queueSources()
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 403 }))
    await expect(resolveConfluenceSiteReadGrants(input)).resolves.toEqual([])
    expect(mocks.token).toHaveBeenCalledTimes(2)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it.each([401, 403, 404, 429, 500, 503])(
    'denies unconfirmed access on HTTP %i',
    async (status) => {
      queueSources()
      mocks.fetch.mockResolvedValueOnce(new Response(null, { status }))
      await expect(resolveConfluenceSiteReadGrants(input)).resolves.toEqual([])
    }
  )

  it.each([
    { accountId: 'bob', type: 'known' },
    { accountId: 'alice', type: 'anonymous' },
    { accountId: 'alice' },
    null,
  ])('denies another identity and incomplete provider data', async (profile) => {
    queueSources()
    mocks.fetch.mockResolvedValueOnce(Response.json(profile))
    await expect(resolveConfluenceSiteReadGrants(input)).resolves.toEqual([])
  })

  it('never substitutes another reader or a crawler when the personal connection is missing', async () => {
    queueSources([{ ...source, providerSubjectId: 'bob' }])
    await expect(resolveConfluenceSiteReadGrants(input)).resolves.toEqual([])
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    await expect(resolveConfluenceSiteReadGrants({ ...input, readers: [] })).resolves.toEqual([])
  })

  it('denies an unavailable scoped crawler credential before checking any reader token', async () => {
    queueSources([source], [])
    await expect(resolveConfluenceSiteReadGrants(input)).resolves.toEqual([])
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each([
    { ...binding, domain: 'another.atlassian.net' },
    { ...binding, cloudId: '../other-cloud' },
    { ...binding, type: 'google_service_account' },
  ])('rejects mismatched or malformed site bindings', async (value) => {
    queueSources()
    mocks.decrypt.mockResolvedValueOnce({ decrypted: JSON.stringify(value) })
    await expect(resolveConfluenceSiteReadGrants(input)).resolves.toEqual([])
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('deduplicates one reader and site only within the current admission', async () => {
    queueSources([source, { ...source, connectorId: 'source-2' }])
    await expect(resolveConfluenceSiteReadGrants(input)).resolves.toHaveLength(2)
    expect(mocks.token).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('never carries an allowed site proof to a denied site', async () => {
    queueSources(
      [source, { ...source, connectorId: 'source-2', contentCredentialId: 'other-crawler' }],
      [contentCredential, { id: 'other-crawler', key: 'encrypted-other-crawler' }]
    )
    mocks.decrypt.mockImplementation(async (key: string) => ({
      decrypted: JSON.stringify({
        ...binding,
        cloudId: key === 'encrypted-crawler' ? 'cloud-1' : 'cloud-2',
      }),
    }))
    mocks.fetch.mockImplementation(async (url: string) =>
      url.includes('/cloud-2/')
        ? new Response(null, { status: 403 })
        : Response.json({ accountId: 'alice', type: 'known' })
    )
    await expect(resolveConfluenceSiteReadGrants(input)).resolves.toEqual([grant])
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps a full bounded batch without enumerating the organization', async () => {
    queueSources(
      Array.from({ length: MAX_KNOWLEDGE_ACCESS_CANDIDATES }, (_, index) => ({
        ...source,
        connectorId: `source-${index}`,
      }))
    )
    await expect(resolveConfluenceSiteReadGrants(input)).resolves.toHaveLength(
      MAX_KNOWLEDGE_ACCESS_CANDIDATES
    )
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(MAX_KNOWLEDGE_ACCESS_CANDIDATES)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    await expect(
      resolveConfluenceSiteReadGrants({ ...input, connectorIds: [...input.connectorIds, 'extra'] })
    ).rejects.toThrow('bounded pages')
  })

  it('does not let multiple reader rows truncate later source candidates', async () => {
    const rows = Array.from({ length: 301 }, (_, index) => ({
      ...source,
      connectorId: `source-${index}`,
    }))
    queueTableRows(schemaMock.knowledgeConnector, rows)
    queueTableRows(schemaMock.credential, [
      { id: 'alice-credential', providerSubjectId: 'alice' },
      { id: 'bob-credential', providerSubjectId: 'bob' },
    ])
    queueTableRows(schemaMock.credential, [contentCredential])
    mocks.token.mockImplementation(async ({ credentialId }: { credentialId: string }) => ({
      accessToken: credentialId,
    }))
    mocks.fetch.mockImplementation(async (_url: string, options: RequestInit) =>
      options.headers &&
      new Headers(options.headers).get('Authorization') === 'Bearer bob-credential'
        ? Response.json({ accountId: 'bob', type: 'known' })
        : new Response(null, { status: 403 })
    )
    const grants = await resolveConfluenceSiteReadGrants({
      ...input,
      connectorIds: rows.map((row) => row.connectorId),
      readers: [
        ...input.readers,
        { credentialId: 'bob-credential', subjectToken: 's:confluence:-:bob' },
      ],
    })
    expect(grants).toHaveLength(301)
    expect(grants.every((entry) => entry.readerSubjectToken === 's:confluence:-:bob')).toBe(true)
    expect(grants.map((entry) => entry.connectorId)).toContain('source-300')
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it('bounds failed site proofs across a source and reader cross product', async () => {
    const rows = Array.from({ length: MAX_KNOWLEDGE_ACCESS_CANDIDATES }, (_, index) => ({
      ...source,
      connectorId: `source-${index}`,
      contentCredentialId: `crawler-${index}`,
    }))
    queueTableRows(schemaMock.knowledgeConnector, rows)
    queueTableRows(schemaMock.credential, [
      { id: 'alice-credential', providerSubjectId: 'alice' },
      { id: 'bob-credential', providerSubjectId: 'bob' },
    ])
    queueTableRows(
      schemaMock.credential,
      rows.map((row, index) => ({ id: row.contentCredentialId, key: `cloud-${index}` }))
    )
    mocks.decrypt.mockImplementation(async (key: string) => ({
      decrypted: JSON.stringify({ ...binding, cloudId: key }),
    }))
    mocks.fetch.mockImplementation(async () => new Response(null, { status: 403 }))
    await expect(
      resolveConfluenceSiteReadGrants({
        ...input,
        connectorIds: rows.map((row) => row.connectorId),
        readers: [
          ...input.readers,
          { credentialId: 'bob-credential', subjectToken: 's:confluence:-:bob' },
        ],
      })
    ).resolves.toEqual([])
    expect(mocks.fetch).toHaveBeenCalledTimes(MAX_KNOWLEDGE_ACCESS_CANDIDATES)
  })

  it.each(['refresh', 'site request'])(
    'uses a working same-subject credential while an older %s stalls for all 400 same-site sources',
    async (stall) => {
      const rows = Array.from({ length: MAX_KNOWLEDGE_ACCESS_CANDIDATES }, (_, index) => ({
        ...source,
        connectorId: `source-${index}`,
      }))
      queueTableRows(schemaMock.knowledgeConnector, rows)
      queueTableRows(schemaMock.credential, [
        { id: 'old-credential', providerSubjectId: 'alice' },
        { id: 'working-credential', providerSubjectId: 'alice' },
      ])
      queueTableRows(schemaMock.credential, [contentCredential])
      mocks.token.mockImplementation(async ({ credentialId }: { credentialId: string }) => {
        if (stall === 'refresh' && credentialId === 'old-credential') return new Promise(() => {})
        return { accessToken: credentialId }
      })
      let stalledSignal: AbortSignal | undefined
      mocks.fetch.mockImplementation(async (_url: string, options: RequestInit) => {
        if (new Headers(options.headers).get('Authorization') === 'Bearer old-credential') {
          stalledSignal = options.signal ?? undefined
          return new Promise<Response>(() => {})
        }
        return Response.json({ accountId: 'alice', type: 'known' })
      })
      const grants = await resolveConfluenceSiteReadGrants({
        ...input,
        connectorIds: rows.map((row) => row.connectorId),
        readers: ['old-credential', 'working-credential'].map((credentialId) => ({
          credentialId,
          subjectToken: 's:confluence:-:alice',
        })),
      })
      expect(grants).toHaveLength(MAX_KNOWLEDGE_ACCESS_CANDIDATES)
      expect(
        grants.every(
          (entry) =>
            entry.readerCredentialId === 'working-credential' && entry.cloudId === 'cloud-1'
        )
      ).toBe(true)
      expect(grants.map((entry) => entry.connectorId)).toContain('source-399')
      expect(mocks.fetch).toHaveBeenCalledTimes(stall === 'refresh' ? 1 : 2)
      expect(mocks.token).toHaveBeenCalledTimes(2)
      if (stall === 'site request') expect(stalledSignal?.aborted).toBe(true)
    }
  )

  it('bounds same-subject alternatives without trying unrelated or unlimited credentials', async () => {
    const credentials = Array.from(
      { length: CONFLUENCE_READ_CREDENTIAL_ALTERNATIVES + 2 },
      (_, index) => ({ id: `reader-${index}`, providerSubjectId: 'alice' })
    )
    queueTableRows(schemaMock.knowledgeConnector, [source])
    queueTableRows(schemaMock.credential, credentials)
    queueTableRows(schemaMock.credential, [contentCredential])
    mocks.fetch.mockImplementation(async () => new Response(null, { status: 403 }))
    await expect(
      resolveConfluenceSiteReadGrants({
        ...input,
        connectorIds: [source.connectorId],
        readers: credentials.map((reader) => ({
          credentialId: reader.id,
          subjectToken: 's:confluence:-:alice',
        })),
      })
    ).resolves.toEqual([])
    expect(mocks.fetch).toHaveBeenCalledTimes(CONFLUENCE_READ_CREDENTIAL_ALTERNATIVES)
    expect(mocks.token).toHaveBeenCalledTimes(CONFLUENCE_READ_CREDENTIAL_ALTERNATIVES)
  })

  it('keeps concurrent credential alternatives bounded while later sites still make progress', async () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      ...source,
      connectorId: `source-${index}`,
      contentCredentialId: `crawler-${index}`,
    }))
    queueTableRows(schemaMock.knowledgeConnector, rows)
    queueTableRows(schemaMock.credential, [
      { id: 'old-credential', providerSubjectId: 'alice' },
      { id: 'working-credential', providerSubjectId: 'alice' },
    ])
    queueTableRows(
      schemaMock.credential,
      rows.map((row, index) => ({ id: row.contentCredentialId, key: `cloud-${index}` }))
    )
    mocks.decrypt.mockImplementation(async (key: string) => ({
      decrypted: JSON.stringify({ ...binding, cloudId: key }),
    }))
    mocks.token.mockImplementation(async ({ credentialId }: { credentialId: string }) => ({
      accessToken: credentialId,
    }))
    let active = 0
    let peak = 0
    mocks.fetch.mockImplementation(async (_url: string, options: RequestInit) => {
      active += 1
      peak = Math.max(peak, active)
      if (new Headers(options.headers).get('Authorization') === 'Bearer old-credential')
        return new Promise<Response>((_resolve, reject) =>
          options.signal?.addEventListener(
            'abort',
            () => {
              active -= 1
              reject(options.signal?.reason)
            },
            { once: true }
          )
        )
      await Promise.resolve()
      active -= 1
      return Response.json({ accountId: 'alice', type: 'known' })
    })
    const grants = await resolveConfluenceSiteReadGrants({
      ...input,
      connectorIds: rows.map((row) => row.connectorId),
      readers: ['old-credential', 'working-credential'].map((credentialId) => ({
        credentialId,
        subjectToken: 's:confluence:-:alice',
      })),
    })
    expect(grants).toHaveLength(6)
    expect(grants.map((entry) => entry.connectorId)).toContain('source-5')
    expect(grants.every((entry) => entry.readerCredentialId === 'working-credential')).toBe(true)
    expect(peak).toBeLessThanOrEqual(CONFLUENCE_READ_CONCURRENCY)
    expect(active).toBe(0)
  })

  it('rejects oversized provider responses', async () => {
    queueSources()
    mocks.fetch.mockResolvedValueOnce(
      new Response('x'.repeat(CONFLUENCE_READ_RESPONSE_MAX_BYTES + 1))
    )
    await expect(resolveConfluenceSiteReadGrants(input)).resolves.toEqual([])
  })

  it.each(['source', 'admission'])(
    'preserves completed sites when a stalled %s deadline expires',
    async (deadline) => {
      const overall = new AbortController()
      const timers: AbortController[] = []
      vi.spyOn(AbortSignal, 'timeout').mockImplementation((duration) => {
        if (duration === CONFLUENCE_READ_TIMEOUT_MS) return overall.signal
        expect(duration).toBe(CONFLUENCE_READ_ATTEMPT_TIMEOUT_MS)
        const timer = new AbortController()
        timers.push(timer)
        return timer.signal
      })
      const count = CONFLUENCE_READ_CONCURRENCY + 2
      queueSources(
        Array.from({ length: count }, (_, index) => ({
          ...source,
          connectorId: `source-${index}`,
          contentCredentialId: `crawler-${index}`,
        })),
        Array.from({ length: count }, (_, index) => ({
          id: `crawler-${index}`,
          key: `cloud-${index}`,
        }))
      )
      mocks.decrypt.mockImplementation(async (key: string) => ({
        decrypted: JSON.stringify({ ...binding, cloudId: key }),
      }))
      let lastFastCheck: (() => void) | undefined
      const allFastChecks = new Promise<void>((resolve) => {
        lastFastCheck = resolve
      })
      let active = 0
      let peak = 0
      mocks.fetch.mockImplementation(async (url: string) => {
        active += 1
        peak = Math.max(peak, active)
        if (url.includes('/cloud-0/')) return new Promise<Response>(() => {})
        await Promise.resolve()
        active -= 1
        if (url.includes(`/cloud-${count - 1}/`)) lastFastCheck?.()
        return Response.json({ accountId: 'alice', type: 'known' })
      })
      const pending = resolveConfluenceSiteReadGrants(input)
      await allFastChecks
      for (let turn = 0; turn < 20; turn++) await Promise.resolve()
      ;(deadline === 'source' ? timers[0] : overall).abort(new Error('deadline'))
      const grants = await pending
      expect(grants).toHaveLength(count - 1)
      expect(grants.map((entry) => entry.connectorId)).not.toContain('source-0')
      expect(peak).toBeLessThanOrEqual(CONFLUENCE_READ_CONCURRENCY)
    }
  )

  it('stops on caller cancellation while a reader token refresh remains pending', async () => {
    queueSources()
    const controller = new AbortController()
    mocks.token.mockImplementation(() => {
      controller.abort(new Error('cancelled'))
      return new Promise(() => {})
    })
    await expect(
      resolveConfluenceSiteReadGrants({ ...input, signal: controller.signal })
    ).rejects.toThrow('cancelled')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
