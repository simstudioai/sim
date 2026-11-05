/**
 * One member connecting several accounts of one provider, against real Postgres so the unique
 * index and the serialized grant persistence are exercised, not a mock of them. Only the provider
 * exchange is faked: the authorization code names the identity the provider would have verified.
 */
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  member,
  organization,
  user,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CredentialGroupOAuthContext } from '@/lib/credential-groups/enrollments'
import { completeCredentialGroupOAuth } from '@/lib/credential-groups/oauth'
import type { CredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'
import { CredentialGroupOAuthError } from '@/lib/credential-groups/provider-adapter'
import type { CredentialGroupProvider } from '@/lib/credential-groups/providers'
import { decryptManagedOAuthTokenSet } from '@/lib/credentials/managed-oauth'
import { resolveSlackSearchMember } from '@/lib/knowledge/application/slack-search/identity'

const POLICY = {
  authorizationAppId: 'fixture-app',
  requiredScopes: ['read'],
  scopeVersion: 1,
}

vi.mock('@/lib/credential-groups/provider-registry', async (importOriginal) => {
  const { getCredentialGroupProviderId } = await import('@/lib/credential-groups/providers')
  return {
    ...(await importOriginal<typeof import('@/lib/credential-groups/provider-registry')>()),
    getCredentialGroupProviderAdapter: (provider: CredentialGroupProvider) => {
      const policy = {
        ...POLICY,
        provider,
        providerId: getCredentialGroupProviderId(provider),
      }
      return {
        provider,
        requiresRefreshToken: false,
        getPolicy: async () => policy,
        exchangeAndVerify: async ({ code }: { code: string }) => {
          const [subject, tenant] = code.split('@')
          return {
            providerId: policy.providerId,
            providerSubjectId: subject,
            providerTenantId: tenant || null,
            displayName: code,
            metadata: { email: code },
            accessToken: `token-for-${code}`,
            grantedScopes: POLICY.requiredScopes,
            accessTokenExpiresAt: null,
            refreshTokenExpiresAt: null,
          }
        },
      }
    },
  }
})

const organizationId = generateId()
const userId = generateId()
const groupId = generateId()
const enrollmentId = generateId()
const invitationToken = generateId()
const email = `${userId}@example.test`

const optionFor = (provider: CredentialGroupProvider) => ({
  id: `option-${provider}`,
  provider,
  label: provider,
  authorizationAppId: POLICY.authorizationAppId,
  requiredScopes: POLICY.requiredScopes,
  scopeVersion: POLICY.scopeVersion,
  required: false,
  status: 'active' as const,
})
const DRIVE = optionFor('google-drive')
const GITHUB = optionFor('github-repositories')
const SLACK = optionFor('slack')

function connect(
  code: string,
  connectionIntent?: CredentialGroupOAuthAttempt['connectionIntent'],
  option = DRIVE
) {
  const context: CredentialGroupOAuthContext = {
    enrollmentId,
    credentialGroupId: groupId,
    credentialGroupName: 'Connected accounts',
    organizationId,
    workspaceName: 'Fixture',
    workspaceOwnerId: null,
    credentialOwnerId: userId,
    email,
    enrollmentStatus: 'completed',
    option,
    options: [DRIVE, GITHUB, SLACK],
  }
  const attempt: CredentialGroupOAuthAttempt = {
    userId,
    state: generateId(),
    provider: option.provider as CredentialGroupProvider,
    nonceHash: 'nonce',
    organizationId,
    email,
    enrollmentId,
    credentialGroupId: groupId,
    optionId: option.id,
    authorizationAppId: POLICY.authorizationAppId,
    scopeVersion: POLICY.scopeVersion,
    requiredScopes: POLICY.requiredScopes,
    redirectUri: 'https://sim.test/callback',
    invitationToken,
    createdAt: Date.now(),
    ...(connectionIntent ? { connectionIntent } : {}),
  }
  return completeCredentialGroupOAuth(context, attempt, code)
}

async function failureOf(result: Promise<unknown>) {
  const error = await result.then(
    () => null,
    (caught: unknown) => caught
  )
  expect(error).toBeInstanceOf(CredentialGroupOAuthError)
  return (error as CredentialGroupOAuthError).failure
}

const rows = () =>
  db
    .select({
      id: credential.id,
      subject: credential.providerSubjectId,
      tenant: credential.providerTenantId,
      status: credential.managedOauthStatus,
      revokedAt: credential.revokedAt,
      tokens: credential.encryptedOauthTokenSet,
    })
    .from(credential)
    .where(eq(credential.organizationId, organizationId))

const disconnect = (id: string) =>
  db
    .update(credential)
    .set({ managedOauthStatus: 'revoked', revokedAt: new Date() })
    .where(eq(credential.id, id))

beforeAll(async () => {
  await db.insert(user).values({
    id: userId,
    name: 'Multiple accounts fixture',
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(organization).values({
    id: organizationId,
    name: 'Multiple accounts fixture',
    slug: organizationId,
    createdAt: new Date(),
  })
  await db.insert(credentialGroup).values({
    id: groupId,
    organizationId,
    publicId: generateId(),
    name: 'Connected accounts',
    options: [DRIVE, GITHUB, SLACK],
  })
  await db.insert(member).values({
    id: generateId(),
    organizationId,
    userId,
    role: 'member',
    createdAt: new Date(),
  })
  await db.insert(credentialGroupEnrollment).values({
    id: enrollmentId,
    credentialGroupId: groupId,
    userId,
    email,
    status: 'completed',
    invitationTokenHash: sha256Hex(invitationToken),
    invitationExpiresAt: new Date(Date.now() + 3_600_000),
    invitedAt: new Date(),
    createdBy: userId,
  })
})

beforeEach(async () => {
  await db.delete(credential).where(eq(credential.organizationId, organizationId))
})

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(eq(user.id, userId))
})

describe('connecting several accounts of one provider', () => {
  it('adds a second identity as its own credential and leaves the first untouched', async () => {
    const first = await connect('work@first-tenant.test', { kind: 'create' })
    const [before] = await rows()

    const second = await connect('work@second-tenant.test', { kind: 'create' })

    expect(second.created).toBe(true)
    expect(second.credentialId).not.toBe(first.credentialId)
    const after = await rows()
    expect(after).toHaveLength(2)
    expect(after.find((row) => row.id === first.credentialId)?.tokens).toBe(before?.tokens)
    const stored = after.find((row) => row.id === second.credentialId)
    expect(stored).toMatchObject({
      subject: 'work',
      tenant: 'second-tenant.test',
      status: 'active',
    })
    expect(await decryptManagedOAuthTokenSet(stored?.tokens ?? '')).toMatchObject({
      accessToken: 'token-for-work@second-tenant.test',
    })
  })

  it('treats one subject in two tenants as two accounts', async () => {
    await connect('same@tenant-a.test', { kind: 'create' })
    await connect('same@tenant-b.test', { kind: 'create' })
    expect(await rows()).toHaveLength(2)
  })

  it('refuses to add an identity that is already connected, changing nothing', async () => {
    await connect('work@first-tenant.test', { kind: 'create' })
    const before = await rows()

    expect(await failureOf(connect('work@first-tenant.test', { kind: 'create' }))).toBe(
      'account_already_connected'
    )
    expect(await rows()).toEqual(before)
  })

  it('stops adding at the per-provider limit, without counting disconnected accounts', async () => {
    const created = []
    for (let index = 0; index < 5; index += 1)
      created.push(await connect(`user-${index}@tenant.test`, { kind: 'create' }))

    expect(await failureOf(connect('user-5@tenant.test', { kind: 'create' }))).toBe(
      'account_limit_reached'
    )
    expect(await rows()).toHaveLength(5)

    await disconnect(created[0]?.credentialId ?? '')
    await connect('user-5@tenant.test', { kind: 'create' })
    expect(await rows()).toHaveLength(6)
  })

  it('never creates two rows when the same identity completes twice at once', async () => {
    const results = await Promise.allSettled([
      connect('work@first-tenant.test', { kind: 'create' }),
      connect('work@first-tenant.test', { kind: 'create' }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await rows()).toHaveLength(1)
  })
})

describe('reconnecting one of several accounts', () => {
  it('refreshes only the targeted credential', async () => {
    const first = await connect('work@first-tenant.test', { kind: 'create' })
    const second = await connect('work@second-tenant.test', { kind: 'create' })
    const before = await rows()

    const reconnected = await connect('work@second-tenant.test', {
      kind: 'reconnect',
      credentialId: second.credentialId,
    })

    expect(reconnected).toMatchObject({ created: false, credentialId: second.credentialId })
    const after = await rows()
    const untouched = (list: typeof after) => list.find((row) => row.id === first.credentialId)
    expect(untouched(after)?.tokens).toBe(untouched(before)?.tokens)
    expect(after).toHaveLength(2)
  })

  it('refuses a different identity, including another connected account of the member', async () => {
    const first = await connect('work@first-tenant.test', { kind: 'create' })
    await connect('work@second-tenant.test', { kind: 'create' })
    const before = await rows()

    const intent = { kind: 'reconnect', credentialId: first.credentialId } as const
    expect(await failureOf(connect('work@second-tenant.test', intent))).toBe('account_mismatch')
    expect(await failureOf(connect('stranger@other.test', intent))).toBe('account_mismatch')
    expect(await rows()).toEqual(before)
  })

  it('refuses a reconnect target that no longer belongs to this option', async () => {
    await connect('work@first-tenant.test', { kind: 'create' })
    await expect(
      connect('work@first-tenant.test', { kind: 'reconnect', credentialId: generateId() })
    ).rejects.toBeInstanceOf(CredentialGroupOAuthError)
    expect(await rows()).toHaveLength(1)
  })
})

describe('after disconnecting', () => {
  it('lets the member connect a different account', async () => {
    const first = await connect('work@first-tenant.test', { kind: 'create' })
    await disconnect(first.credentialId)

    const replacement = await connect('work@second-tenant.test', { kind: 'create' })

    expect(replacement.created).toBe(true)
    const after = await rows()
    expect(after.find((row) => row.id === first.credentialId)?.status).toBe('revoked')
    expect(after.find((row) => row.id === replacement.credentialId)?.status).toBe('active')
  })

  it('restores the same credential when the same identity returns', async () => {
    const first = await connect('work@first-tenant.test', { kind: 'create' })
    await disconnect(first.credentialId)

    const restored = await connect('work@first-tenant.test', { kind: 'create' })

    expect(restored).toMatchObject({ created: false, credentialId: first.credentialId })
    expect(await rows()).toHaveLength(1)
    expect((await rows())[0]).toMatchObject({ status: 'active', revokedAt: null })
  })
})

describe('every provider', () => {
  it.each([DRIVE, GITHUB, SLACK])('accepts several accounts of $provider', async (option) => {
    await connect('first@tenant.test', { kind: 'create' }, option)
    await connect('second@tenant.test', { kind: 'create' }, option)
    expect(await rows()).toHaveLength(2)
  })
})

describe('resolving a Slack sender for a member with several Slack accounts', () => {
  const resolve = (slackUserId: string) =>
    resolveSlackSearchMember(organizationId, 'T1', slackUserId, email)

  it('accepts each linked account and refuses a sender linked to neither', async () => {
    await connect('U1@T1', { kind: 'create' }, SLACK)
    await connect('U2@T1', { kind: 'create' }, SLACK)

    await expect(resolve('U1')).resolves.toBe(userId)
    await expect(resolve('U2')).resolves.toBe(userId)
    await expect(resolve('U3')).rejects.toThrow('verified Sim account')
  })

  it('still accepts a member with no linked Slack account', async () => {
    await expect(resolve('U1')).resolves.toBe(userId)
  })
})

describe('invitation links, which carry no connection intent', () => {
  it('refresh the matching identity', async () => {
    const first = await connect('work@first-tenant.test')
    const again = await connect('work@first-tenant.test')
    expect(again).toMatchObject({ created: false, credentialId: first.credentialId })
  })

  it('refuse to silently add a second account beside a live one', async () => {
    await connect('work@first-tenant.test')
    expect(await failureOf(connect('work@second-tenant.test'))).toBe('account_mismatch')
    expect(await rows()).toHaveLength(1)
  })
})
