import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  organization,
  user,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { jsonResponse } from '@sim/testing/helpers/http'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCredentialGroupEnrollment } from '@/lib/credential-groups/enrollments'
import type { CredentialGroupProviderPolicy } from '@/lib/credential-groups/provider-adapter'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import {
  encryptManagedOAuthTokenSet,
  resolveManagedOAuthToken,
} from '@/lib/credentials/managed-oauth'

vi.hoisted(() => {
  process.env.SALESFORCE_CLIENT_ID = 'managed-destination-fixture-client'
  process.env.SALESFORCE_CLIENT_SECRET = 'managed-destination-fixture-secret'
})

const organizationId = generateId()
const userId = generateId()
const groupId = generateId()
const enrollmentId = generateId()
const credentialId = generateId()
const invitationToken = generateId()
const instanceUrl = 'https://managed-destination-fixture.my.salesforce.com'
let policy: CredentialGroupProviderPolicy
let accessToken: string

const resolve = (requiredScopes = ['api']) =>
  resolveManagedOAuthToken({
    credentialId,
    organizationId,
    expectedProviderId: 'salesforce',
    requiredScopes,
  })

function stubIdentity(respond: (request: Request) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    if (request.url !== 'https://login.salesforce.com/services/oauth2/userinfo') {
      throw new Error(`Unexpected provider request: ${request.url}`)
    }
    return respond(request)
  })
}

beforeAll(async () => {
  policy = await getCredentialGroupProviderAdapter('salesforce').getPolicy(undefined, {})
  await db.insert(user).values({
    id: userId,
    name: 'Managed destination fixture',
    email: `${userId}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(organization).values({
    id: organizationId,
    name: 'Managed destination fixture',
    slug: organizationId,
    createdAt: new Date(),
  })
  await db.insert(credentialGroup).values({
    id: groupId,
    organizationId,
    publicId: generateId(),
    name: 'Connected accounts',
    options: [
      {
        id: 'salesforce',
        provider: 'salesforce',
        label: 'Salesforce',
        authorizationAppId: policy.authorizationAppId,
        requiredScopes: policy.requiredScopes,
        scopeVersion: policy.scopeVersion,
        required: false,
        status: 'active',
      },
    ],
  })
  await db.insert(credentialGroupEnrollment).values({
    id: enrollmentId,
    credentialGroupId: groupId,
    userId,
    email: `${userId}@example.test`,
    status: 'completed',
    invitationTokenHash: sha256Hex(invitationToken),
    invitationExpiresAt: new Date(Date.now() + 3_600_000),
    invitedAt: new Date(),
    createdBy: userId,
  })
})

beforeEach(async () => {
  accessToken = `managed-destination-${generateId()}`
  await db.insert(credential).values({
    id: credentialId,
    organizationId,
    type: 'managed_oauth',
    createdBy: userId,
    displayName: `${userId}@example.test`,
    providerId: 'salesforce',
    providerSubjectId: credentialId,
    credentialGroupEnrollmentId: enrollmentId,
    credentialGroupOptionId: 'salesforce',
    authorizationAppId: policy.authorizationAppId,
    managedOauthScopeVersion: policy.scopeVersion === 1 ? 2 : 1,
    managedOauthStatus: 'active',
    grantedScopes: policy.requiredScopes,
    encryptedOauthTokenSet: await encryptManagedOAuthTokenSet({ accessToken }),
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    grantedAt: new Date(),
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await db.delete(credential).where(eq(credential.id, credentialId))
})

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(eq(user.id, userId))
})

describe('managed Salesforce destination resolution', () => {
  it('shares verified destinations across concurrent calls and subsequent identity outages', async () => {
    let requests = 0
    stubIdentity((request) => {
      expect(request.headers.get('authorization')).toBe(`Bearer ${accessToken}`)
      requests += 1
      return requests === 1
        ? jsonResponse({ urls: { rest: `${instanceUrl}/services/data/v{version}/` } })
        : jsonResponse({ error: 'temporarily_unavailable' }, 503)
    })

    const results = await Promise.all(Array.from({ length: 6 }, () => resolve()))
    expect(results.map((result) => result.instanceUrl)).toEqual(Array(6).fill(instanceUrl))
    await expect(resolve()).resolves.toMatchObject({ accessToken, instanceUrl })
    expect(requests).toBe(1)
  })

  it.each(['unavailable', 'invalid_origin'] as const)(
    'allows retry after an identity response is %s',
    async (failure) => {
      let requests = 0
      stubIdentity(() => {
        requests += 1
        if (requests === 1) {
          return failure === 'unavailable'
            ? jsonResponse({ error: 'temporarily_unavailable' }, 503)
            : jsonResponse({ urls: { rest: 'https://untrusted.example/services/data/' } })
        }
        return jsonResponse({ urls: { rest: `${instanceUrl}/services/data/v{version}/` } })
      })

      await expect(resolve()).rejects.toMatchObject({
        code: 'MANAGED_CREDENTIAL_IDENTITY_UNAVAILABLE',
      })
      await expect(resolve()).resolves.toMatchObject({ instanceUrl })
      expect(requests).toBe(2)
    }
  )

  it('discovers a new destination after token rotation', async () => {
    const nextToken = `managed-destination-${generateId()}`
    const nextInstanceUrl = 'https://rotated-destination-fixture.my.salesforce.com'
    stubIdentity((request) => {
      const destination =
        request.headers.get('authorization') === `Bearer ${nextToken}`
          ? nextInstanceUrl
          : instanceUrl
      return jsonResponse({ urls: { rest: `${destination}/services/data/v{version}/` } })
    })
    await expect(resolve()).resolves.toMatchObject({ instanceUrl })
    await db
      .update(credential)
      .set({
        encryptedOauthTokenSet: await encryptManagedOAuthTokenSet({ accessToken: nextToken }),
      })
      .where(eq(credential.id, credentialId))
    await expect(resolve()).resolves.toMatchObject({
      accessToken: nextToken,
      instanceUrl: nextInstanceUrl,
    })
  })

  it.each([
    { update: { managedOauthStatus: 'revoked' as const }, code: 'MANAGED_CREDENTIAL_REVOKED' },
    { update: { grantedScopes: [] }, code: 'MANAGED_CREDENTIAL_INSUFFICIENT_SCOPE' },
    { update: { authorizationAppId: 'another-app' }, code: 'MANAGED_CREDENTIAL_NEEDS_REAUTH' },
  ])(
    'rechecks credential authority before reusing a destination: $code',
    async ({ update, code }) => {
      stubIdentity(() =>
        jsonResponse({ urls: { rest: `${instanceUrl}/services/data/v{version}/` } })
      )
      await expect(resolve()).resolves.toMatchObject({ instanceUrl })
      await db.update(credential).set(update).where(eq(credential.id, credentialId))
      await expect(resolve()).rejects.toMatchObject({ code })
    }
  )
})

describe('managed enrollment scope status', () => {
  it('keeps a fully granted account connected when only its stored scope fingerprint differs', async () => {
    const enrollment = await getPublicCredentialGroupEnrollment(invitationToken)
    expect(enrollment?.options[0]?.connections[0]?.status).toBe('connected')
  })

  it('requests new permissions without disabling operations the existing grant already covers', async () => {
    stubIdentity(() => jsonResponse({ urls: { rest: `${instanceUrl}/services/data/v{version}/` } }))
    await db
      .update(credential)
      .set({ grantedScopes: ['api'] })
      .where(eq(credential.id, credentialId))
    const enrollment = await getPublicCredentialGroupEnrollment(invitationToken)
    expect(enrollment?.options[0]?.connections[0]?.status).toBe('needs_reauth')
    await expect(resolve()).resolves.toMatchObject({ instanceUrl })
  })
})
