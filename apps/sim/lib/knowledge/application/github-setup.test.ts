/** @vitest-environment node */
import { db } from '@sim/db'
import { credential, member, user } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => {
  const values = new Map<string, { value: string; expires: number }>()
  return {
    values,
    get: vi.fn(async (key: string) => {
      const entry = values.get(key)
      return entry && entry.expires > Date.now() ? entry.value : null
    }),
    set: vi.fn(
      async (key: string, value: string, _unit: string, ttl: number, condition: string) => {
        const entry = values.get(key)
        const exists = entry && entry.expires > Date.now()
        if ((condition === 'NX' && exists) || (condition === 'XX' && !exists)) return null
        values.set(key, { value, expires: Date.now() + ttl })
        return 'OK'
      }
    ),
    eval: vi.fn(
      async (
        _script: string,
        _count: number,
        key: string,
        nextValue: string,
        expected: string,
        ttl: number
      ) => {
        const entry = values.get(key)
        if (!entry || entry.expires <= Date.now()) return 0
        const current = JSON.parse(entry.value) as Record<string, unknown>
        const next = JSON.parse(nextValue) as Record<string, unknown>
        if (
          current.phase !== expected ||
          ['organizationId', 'userId', 'sessionId', 'setupId', 'createdAt'].some(
            (field) => current[field] !== next[field]
          )
        )
          return 0
        values.set(key, { value: nextValue, expires: Date.now() + ttl })
        return 1
      }
    ),
    list: vi.fn(),
    connect: vi.fn(),
    reader: vi.fn(),
    receipt: vi.fn(),
    provision: vi.fn(),
    enrollment: vi.fn(),
    oauthContext: vi.fn(),
    oauthStart: vi.fn(),
    oauthComplete: vi.fn(),
  }
})
vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: () => ({ get: m.get, set: m.set, eval: m.eval }),
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.example' }))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOrganizationContext: async ({ organizationId }: { organizationId: string }) => ({
    organizationId,
    workspaceId: undefined,
  }),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: async () => null,
}))
vi.mock('@/lib/knowledge/application/github-installations', () => ({
  listGitHubSearchInstallations: { execute: m.list },
  connectGitHubSearchInstallation: { execute: m.connect },
  findGitHubSearchReaderCredential: m.reader,
}))
vi.mock('@/lib/knowledge/connectors/member-provisioning', () => ({
  provisionKnowledgeConnectorMembersBinding: m.provision,
}))
vi.mock('@/lib/credential-groups/self-enrollment', () => ({
  createViewerCredentialGroupEnrollment: m.enrollment,
}))
vi.mock('@/lib/credential-groups/enrollments', () => ({
  getCredentialGroupOAuthContextForEnrollment: m.oauthContext,
}))
vi.mock('@/lib/credential-groups/oauth', () => ({ startCredentialGroupOAuth: m.oauthStart }))
vi.mock('@/lib/credential-groups/application/public-enrollment', () => ({
  completePublicCredentialGroupOAuth: { execute: m.oauthComplete },
}))
vi.mock('@/lib/credential-groups/search-connection-completion', () => ({
  readSearchConnectionCompletion: m.receipt,
}))
vi.mock('@/connectors/registry', () => ({
  CONNECTOR_META_REGISTRY: {
    github: { name: 'GitHub', auth: { mode: 'oauth', provider: 'github-repositories' } },
  },
}))
vi.mock('@/lib/credentials/managed-oauth', () => ({
  ManagedOAuthCredentialError: class extends Error {},
}))
vi.mock('@/lib/oauth/github-installation', () => ({
  GitHubInstallationError: class extends Error {},
  getGitHubInstallationConfiguration: () => ({
    configured: true,
    installUrl: 'https://github.com/apps/test-search/installations/new',
  }),
}))

import {
  cancelGitHubSearchSetup,
  completeGitHubSearchSetup,
  completeGitHubSetupReaderOAuth,
  continueGitHubSearchSetup,
  readGitHubSearchSetup,
  selectGitHubSearchSetup,
  startGitHubSearchSetup,
} from '@/lib/knowledge/application/github-setup'
import {
  GITHUB_SETUP_TTL_MS,
  readGitHubSetupAttempt,
  saveGitHubSetupAttempt,
} from '@/lib/knowledge/github-setup-state'

const principal = { kind: 'session', userId: 'admin', sessionId: 'browser-1' } as const
const input = { organizationId: 'organization', setupId: '550e8400-e29b-41d4-a716-446655440000' }
const scope = { ...input, userId: principal.userId, sessionId: principal.sessionId }
const installation = {
  installationId: '42',
  accountId: '7',
  accountLogin: 'example',
  accountType: 'Organization' as const,
}
const secondInstallation = {
  ...installation,
  installationId: '43',
  accountId: '8',
  accountLogin: 'another',
}
const reader = { id: 'reader' }
const resultCredential = { id: 'installation-credential', displayName: 'example' }
function admin(role = 'admin') {
  queueTableRows(member, [{ role }])
}
async function start(intent?: 'install') {
  admin()
  return startGitHubSearchSetup.execute({
    principal,
    input: { ...input, ...(intent ? { intent } : {}) },
  })
}
async function status() {
  admin()
  return readGitHubSearchSetup.execute({ principal, input })
}
async function cancel() {
  admin()
  return cancelGitHubSearchSetup.execute({ principal, input })
}
async function callback(state: string, installationId = '42') {
  admin()
  return completeGitHubSearchSetup.execute({
    principal,
    input: { state, installationId, setupAction: 'install' },
  })
}
async function resume() {
  admin()
  return continueGitHubSearchSetup.execute({ principal, input })
}
const oauthAttempt = {
  state: 'cg_fixture',
  provider: 'github-repositories' as const,
  userId: principal.userId,
  organizationId: input.organizationId,
  email: 'admin@example.test',
  credentialGroupId: 'group',
  enrollmentId: 'enrollment',
  optionId: 'option',
  authorizationAppId: 'app',
  scopeVersion: 1,
  nonceHash: 'hash',
  requiredScopes: [],
  redirectUri: 'https://sim.example/api/auth/oauth2/callback/github-repositories',
  completionRedirect: true,
  completionId: input.setupId,
  returnTo: 'github-installation' as const,
  invitationToken: 'fixture-invitation',
  createdAt: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  m.values.clear()
  m.list.mockResolvedValue({ available: true, needsUserConnection: false, installations: [] })
  m.connect.mockResolvedValue({ credential: resultCredential, created: true })
  m.reader.mockResolvedValue(reader)
  m.receipt.mockResolvedValue(null)
  m.provision.mockResolvedValue({ credentialGroupId: 'group', credentialGroupOptionId: 'option' })
  m.enrollment.mockResolvedValue({
    enrollment: { id: 'enrollment', email: 'admin@example.test' },
    invitationLink: 'https://sim.example/credential-groups/enroll/fixture-invitation',
  })
  m.oauthContext.mockResolvedValue({ fixture: 'oauth-context' })
  m.oauthStart.mockResolvedValue('https://github.com/login/oauth/authorize?state=cg_fixture')
  m.oauthComplete.mockResolvedValue({ credentialId: 'reader' })
})
afterEach(() => {
  vi.useRealTimers()
  resetDbChainMock()
})

describe('GitHub setup lifecycle', () => {
  it.each(['member', 'missing'])(
    'requires current organization admin access before state or provider work: %s',
    async (role) => {
      queueTableRows(member, role === 'missing' ? [] : [{ role }])
      await expect(startGitHubSearchSetup.execute({ principal, input })).rejects.toMatchObject({
        code: role === 'missing' ? 'not_found' : 'forbidden',
      })
      expect(m.set).not.toHaveBeenCalled()
      expect(m.list).not.toHaveBeenCalled()
    }
  )
  it('refuses non-session principals before state lookup', async () => {
    await expect(
      startGitHubSearchSetup.execute({
        principal: { kind: 'personal_api_key', userId: 'admin', keyId: 'key' },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(m.get).not.toHaveBeenCalled()
  })
  it('issues opaque state, verifies installation binding through the existing operation, and makes refresh idempotent', async () => {
    const { url } = await start()
    const state = new URL(url).searchParams.get('state')!
    expect(state).not.toBe(input.setupId)
    expect(url).not.toContain(input.organizationId)
    expect(new URL(url).pathname).toBe('/apps/test-search/installations/new')
    await callback(state)
    expect(m.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        input: expect.objectContaining({
          organizationId: input.organizationId,
          installationId: '42',
        }),
      })
    )
    await expect(status()).resolves.toEqual({ status: 'completed', credential: resultCredential })
    await callback(state)
    expect(m.connect).toHaveBeenCalledTimes(1)
  })
  it('reuses a sole eligible installation without forcing GitHub configuration', async () => {
    m.list.mockResolvedValue({
      available: true,
      needsUserConnection: false,
      installations: [installation],
    })
    const { url } = await start()
    expect(new URL(url).pathname).toBe('/credential-groups/complete')
    expect(new URL(url).searchParams.get('completionId')).toBe(input.setupId)
    await expect(status()).resolves.toEqual({ status: 'completed', credential: resultCredential })
  })
  it('preserves explicit install intent even when one installation exists', async () => {
    m.list.mockResolvedValue({
      available: true,
      needsUserConnection: false,
      installations: [installation],
    })
    const { url } = await start('install')
    expect(new URL(url).hostname).toBe('github.com')
    expect(m.connect).not.toHaveBeenCalled()
  })
  it('offers multiple installations using bounded metadata and rejects choices not offered', async () => {
    m.list.mockResolvedValue({
      available: true,
      needsUserConnection: false,
      installations: [{ ...installation, appClientId: 'private-extra' }, secondInstallation],
    })
    expect(new URL((await start()).url).pathname).toBe('/knowledge/github/setup')
    await expect(status()).resolves.toEqual({
      status: 'choosing',
      installations: [installation, secondInstallation],
    })
    admin()
    await expect(
      selectGitHubSearchSetup.execute({
        principal,
        input: { ...input, action: { kind: 'select', installationId: '999' } },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(m.connect).not.toHaveBeenCalled()
    admin()
    await selectGitHubSearchSetup.execute({
      principal,
      input: { ...input, action: { kind: 'select', installationId: '43' } },
    })
    expect(m.connect).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ installationId: '43' }) })
    )
  })
  it('status reads never poll GitHub or return OAuth/state material', async () => {
    await start()
    m.list.mockClear()
    await expect(status()).resolves.toEqual({ status: 'pending' })
    expect(m.list).not.toHaveBeenCalled()
    expect(m.reader).not.toHaveBeenCalled()
  })
  it.each([{ userId: 'other-user' }, { sessionId: 'other-browser' }])(
    'cannot read or consume another initiating session: %s',
    async (change) => {
      const state = new URL((await start()).url).searchParams.get('state')!
      const other = { ...principal, ...change }
      admin()
      await expect(readGitHubSearchSetup.execute({ principal: other, input })).resolves.toEqual({
        status: 'expired',
      })
      await expect(
        completeGitHubSearchSetup.execute({
          principal: other,
          input: { state, installationId: '42' },
        })
      ).rejects.toMatchObject({ code: 'validation' })
      expect(m.connect).not.toHaveBeenCalled()
      await callback(state)
    }
  )
  it('keeps organization scopes isolated even when the correlation ID is known', async () => {
    await start()
    admin()
    await expect(
      readGitHubSearchSetup.execute({
        principal,
        input: { ...input, organizationId: 'another-org' },
      })
    ).resolves.toEqual({ status: 'expired' })
  })
  it('cancellation prevents late callbacks and repeated begin with the same ID', async () => {
    const state = new URL((await start()).url).searchParams.get('state')!
    await cancel()
    await expect(callback(state)).rejects.toMatchObject({ code: 'validation' })
    await expect(start()).rejects.toMatchObject({ code: 'validation' })
    await expect(status()).resolves.toEqual({ status: 'expired' })
    expect(m.connect).not.toHaveBeenCalled()
  })
  it('a cancellation arriving before start leaves a tombstone', async () => {
    await cancel()
    await expect(start()).rejects.toMatchObject({ code: 'validation' })
    expect(m.list).not.toHaveBeenCalled()
  })
  it('cancellation after committed completion preserves the result', async () => {
    const state = new URL((await start()).url).searchParams.get('state')!
    await callback(state)
    await cancel()
    await expect(status()).resolves.toEqual({ status: 'completed', credential: resultCredential })
  })
  it('expires without a sliding refresh window', async () => {
    vi.useFakeTimers()
    const { url } = await start()
    vi.advanceTimersByTime(GITHUB_SETUP_TTL_MS - 1)
    await expect(status()).resolves.toEqual({ status: 'pending' })
    vi.advanceTimersByTime(1)
    await expect(status()).resolves.toEqual({ status: 'expired' })
    await expect(callback(new URL(url).searchParams.get('state')!)).rejects.toMatchObject({
      code: 'validation',
    })
    expect(m.connect).not.toHaveBeenCalled()
  })
  it('rechecks current administrator access on the callback', async () => {
    const state = new URL((await start()).url).searchParams.get('state')!
    admin('member')
    await expect(
      completeGitHubSearchSetup.execute({ principal, input: { state, installationId: '42' } })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(m.connect).not.toHaveBeenCalled()
  })
  it('records a safe failure and never exposes provider response bodies', async () => {
    const state = new URL((await start()).url).searchParams.get('state')!
    m.connect.mockRejectedValueOnce(new Error('secret_token fixture@example.test provider-body'))
    await callback(state)
    await expect(status()).resolves.toEqual({
      status: 'failed',
      error: 'GitHub setup could not finish. Try again.',
    })
    expect(JSON.stringify([...m.values.values()])).not.toContain('secret_token')
  })
  it('an installation request awaiting GitHub approval cannot create a credential', async () => {
    const state = new URL((await start()).url).searchParams.get('state')!
    admin()
    await completeGitHubSearchSetup.execute({ principal, input: { state, setupAction: 'request' } })
    expect(m.connect).not.toHaveBeenCalled()
    await expect(status()).resolves.toMatchObject({ status: 'failed' })
  })
})

describe('GitHub setup reader OAuth continuation', () => {
  async function startOAuth(intent?: 'install') {
    m.list.mockResolvedValueOnce({ available: true, needsUserConnection: true, installations: [] })
    queueTableRows(credential, [])
    return start(intent)
  }
  it('starts the existing OAuth boundary and requires its receipt plus a current reader to continue', async () => {
    await startOAuth()
    expect(m.oauthStart).toHaveBeenCalledWith({ fixture: 'oauth-context' }, 'fixture-invitation', {
      completionRedirect: true,
      completionId: input.setupId,
      returnTo: 'github-installation',
      connectionIntent: { kind: 'create' },
    })
    await expect(resume()).rejects.toMatchObject({ code: 'forbidden' })
    m.receipt.mockResolvedValue('wrong-reader')
    await expect(resume()).rejects.toMatchObject({ code: 'forbidden' })
    m.receipt.mockResolvedValue(reader.id)
    expect(new URL((await resume()).url).hostname).toBe('github.com')
  })
  it('preserves explicit install intent after OAuth with existing installations', async () => {
    await startOAuth('install')
    m.receipt.mockResolvedValue(reader.id)
    m.list.mockResolvedValue({
      available: true,
      needsUserConnection: false,
      installations: [installation],
    })
    expect(new URL((await resume()).url).hostname).toBe('github.com')
    expect(m.connect).not.toHaveBeenCalled()
  })
  it('a revoked enrollment stays denied before provider authorization', async () => {
    m.enrollment.mockRejectedValueOnce(new Error('revoked'))
    await startOAuth()
    expect(m.oauthStart).not.toHaveBeenCalled()
    await expect(status()).resolves.toMatchObject({ status: 'failed' })
  })
  it('requires the exact OAuth attempt and verified current user before completing the reader grant', async () => {
    await startOAuth()
    admin()
    await expect(
      completeGitHubSetupReaderOAuth.execute({
        principal,
        input: { attempt: { ...oauthAttempt, state: 'wrong-state' }, code: 'fixture-code' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(m.oauthComplete).not.toHaveBeenCalled()
    admin()
    queueTableRows(user, [{ emailVerified: false }])
    await expect(
      completeGitHubSetupReaderOAuth.execute({
        principal,
        input: { attempt: oauthAttempt, code: 'fixture-code' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    admin()
    queueTableRows(user, [{ emailVerified: true }])
    await completeGitHubSetupReaderOAuth.execute({
      principal,
      input: { attempt: oauthAttempt, code: 'fixture-code' },
    })
    expect(m.oauthComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({
          kind: 'credential_group_enrollment',
          userId: 'admin',
          organizationId: 'organization',
          enrollmentId: 'enrollment',
        }),
      })
    )
  })
  it('cancellation prevents the intermediate OAuth grant as well as installation', async () => {
    await startOAuth()
    await cancel()
    admin()
    await expect(
      completeGitHubSetupReaderOAuth.execute({
        principal,
        input: { attempt: oauthAttempt, code: 'fixture-code' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(m.oauthComplete).not.toHaveBeenCalled()
  })
  it('maps OAuth failure classifications into the authoritative setup status', async () => {
    await startOAuth()
    admin()
    await continueGitHubSearchSetup.execute({
      principal,
      input: { ...input, oauth: 'github_email_mismatch' },
    })
    await expect(status()).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('verified secondary email'),
    })
    expect(m.connect).not.toHaveBeenCalled()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('GitHub setup atomic claims', () => {
  it('never wraps nested authorized operations in a global-pool transaction', async () => {
    m.list.mockImplementationOnce(async () => {
      expect(db.transaction).not.toHaveBeenCalled()
      return { available: true, needsUserConnection: false, installations: [installation] }
    })
    m.connect.mockImplementationOnce(async () => {
      expect(db.transaction).not.toHaveBeenCalled()
      return { credential: resultCredential }
    })
    await start()
  })
  it('cancellation during discovery prevents the final grant claim', async () => {
    const entered = deferred<void>()
    const listed = deferred<{
      available: boolean
      needsUserConnection: boolean
      installations: (typeof installation)[]
    }>()
    m.list.mockImplementationOnce(() => {
      entered.resolve()
      return listed.promise
    })
    const pending = start()
    await entered.promise
    await cancel()
    listed.resolve({ available: true, needsUserConnection: false, installations: [installation] })
    await expect(pending).rejects.toMatchObject({ code: 'conflict' })
    expect(m.connect).not.toHaveBeenCalled()
    await expect(status()).resolves.toEqual({ status: 'expired' })
  })
  it('a claimed final grant survives cancellation and concurrent callback replay without a duplicate grant', async () => {
    const state = new URL((await start()).url).searchParams.get('state')!
    const entered = deferred<void>()
    const connected = deferred<{ credential: typeof resultCredential }>()
    m.connect.mockImplementationOnce(() => {
      entered.resolve()
      return connected.promise
    })
    const pending = callback(state)
    await entered.promise
    await cancel()
    await callback(state)
    expect(m.connect).toHaveBeenCalledTimes(1)
    connected.resolve({ credential: resultCredential })
    await pending
    await expect(status()).resolves.toEqual({ status: 'completed', credential: resultCredential })
  })
  it('cancellation during a reader grant prevents subsequent installation continuation', async () => {
    m.list.mockResolvedValueOnce({ available: true, needsUserConnection: true, installations: [] })
    queueTableRows(credential, [])
    await start()
    const entered = deferred<void>()
    const authorized = deferred<{ credentialId: string }>()
    m.oauthComplete.mockImplementationOnce(() => {
      entered.resolve()
      return authorized.promise
    })
    admin()
    queueTableRows(user, [{ emailVerified: true }])
    const pending = completeGitHubSetupReaderOAuth.execute({
      principal,
      input: { attempt: oauthAttempt, code: 'fixture-code' },
    })
    await entered.promise
    await cancel()
    authorized.resolve({ credentialId: 'reader' })
    await pending
    m.receipt.mockResolvedValue('reader')
    await expect(resume()).rejects.toMatchObject({ code: 'validation' })
    expect(m.connect).not.toHaveBeenCalled()
    await expect(status()).resolves.toEqual({ status: 'expired' })
  })
  it('an interrupted claim is not replayed and expires into a recoverable new attempt', async () => {
    vi.useFakeTimers()
    const state = new URL((await start()).url).searchParams.get('state')!
    const attempt = (await readGitHubSetupAttempt(scope))!
    await saveGitHubSetupAttempt(
      { ...scope, createdAt: attempt.createdAt, phase: 'connecting', installationId: '42', state },
      'installing'
    )
    await callback(state)
    await cancel()
    expect(m.connect).not.toHaveBeenCalled()
    vi.advanceTimersByTime(GITHUB_SETUP_TTL_MS)
    await expect(status()).resolves.toEqual({ status: 'expired' })
    m.list.mockResolvedValue({
      available: true,
      needsUserConnection: false,
      installations: [installation],
    })
    admin()
    await startGitHubSearchSetup.execute({
      principal,
      input: { ...input, setupId: '660e8400-e29b-41d4-a716-446655440000' },
    })
    expect(m.connect).toHaveBeenCalledTimes(1)
  })
  it('fails closed when Redis refuses the transition before the grant', async () => {
    const state = new URL((await start()).url).searchParams.get('state')!
    m.eval.mockRejectedValueOnce(new Error('Redis unavailable'))
    await expect(callback(state)).rejects.toThrow('Redis unavailable')
    expect(m.connect).not.toHaveBeenCalled()
  })
})
