import type { Entitlement } from '@aws-sdk/client-marketplace-entitlement-service'
import { db } from '@sim/db'
import { auditLog, awsMarketplaceLicense, member, organization, user } from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { emailMailerMock, emailMailerMockFns } from '@sim/testing/mocks/email-mailer.mock'
import { requestUtilsMock, requestUtilsMockFns } from '@sim/testing/mocks/request.mock'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const PRODUCT = 'product-placeholder'

const { meteringSend, entitlementSend, queueSend } = vi.hoisted(() => {
  process.env.AWS_MARKETPLACE_PRODUCT_CODE = 'product-placeholder'
  process.env.AWS_MARKETPLACE_EVENTS_QUEUE_URL =
    'https://queue.example.test/aws-marketplace-placeholder'
  return { meteringSend: vi.fn(), entitlementSend: vi.fn(), queueSend: vi.fn() }
})

vi.mock('@aws-sdk/client-marketplace-metering', () => ({
  MarketplaceMeteringClient: class {
    send = meteringSend
  },
  ResolveCustomerCommand: class {
    constructor(public input: { RegistrationToken: string }) {}
  },
}))
vi.mock('@aws-sdk/client-marketplace-entitlement-service', () => ({
  MarketplaceEntitlementServiceClient: class {
    send = entitlementSend
  },
  GetEntitlementsCommand: class {
    constructor(public input: { Filter: { LICENSE_ARN: string[] } }) {}
  },
}))
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: class {
    send = queueSend
  },
  ReceiveMessageCommand: class {
    readonly kind = 'receive'
    constructor(public input: unknown) {}
  },
  DeleteMessageCommand: class {
    readonly kind = 'delete'
    constructor(public input: { ReceiptHandle: string }) {}
  },
}))
vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)
vi.mock('@/lib/core/utils/request', () => requestUtilsMock)

import {
  linkAwsMarketplaceLicense,
  registerAwsMarketplaceLicenseToAccount,
} from '@/lib/billing/aws-marketplace/application/use-cases'
import { hashClaimToken } from '@/lib/billing/aws-marketplace/claim'
import { reconcileAwsMarketplaceLicenses } from '@/lib/billing/aws-marketplace/reconcile'
import { POST as register } from '@/app/api/marketplace/aws/register/route'

/** What GetEntitlements answers for each license ARN; an Error is thrown instead. */
const entitlementsByLicense = new Map<string, Entitlement[] | Error>()
const licenseArns: string[] = []
const userIds: string[] = []
const organizationIds: string[] = []

function uniqueArn(): string {
  const arn = `license-${generateId()}`
  licenseArns.push(arn)
  return arn
}

function currentEntitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    ProductCode: PRODUCT,
    Dimension: 'enterprise',
    CustomerIdentifier: 'customer-placeholder',
    CustomerAWSAccountId: '000000000000',
    Value: { IntegerValue: 25 },
    ExpirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    ...overrides,
  }
}

function lapsedEntitlement(): Entitlement {
  return currentEntitlement({ ExpirationDate: new Date(Date.now() - 60_000) })
}

function throttled(): Error {
  return Object.assign(new Error('Rate exceeded'), {
    name: 'ThrottlingException',
    $metadata: { httpStatusCode: 400 },
  })
}

function registration(body: string, contentType = 'application/x-www-form-urlencoded') {
  requestUtilsMockFns.mockGetClientIp.mockReturnValue(`198.51.100.${licenseArns.length + 1}`)
  return register(
    new NextRequest('http://localhost:3000/api/marketplace/aws/register', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    }),
    {}
  )
}

function resolvesTo(licenseArn: string, productCode = PRODUCT) {
  meteringSend.mockResolvedValueOnce({
    CustomerIdentifier: 'customer-placeholder',
    CustomerAWSAccountId: '000000000000',
    ProductCode: productCode,
    LicenseArn: licenseArn,
  })
}

async function readLicense(licenseArn: string) {
  const [row] = await db
    .select()
    .from(awsMarketplaceLicense)
    .where(eq(awsMarketplaceLicense.licenseArn, licenseArn))
  return row
}

async function createUser(): Promise<string> {
  const id = generateId()
  userIds.push(id)
  await db.insert(user).values({
    id,
    name: 'Marketplace fixture',
    email: `${id}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

async function createOrganization(members: Array<{ userId: string; role: string }>) {
  const id = generateId()
  organizationIds.push(id)
  await db.insert(organization).values({
    id,
    name: 'Marketplace organization',
    slug: id,
    createdAt: new Date(),
  })
  await db.insert(member).values(
    members.map((entry) => ({
      id: generateId(),
      organizationId: id,
      ...entry,
      createdAt: new Date(),
    }))
  )
  return id
}

/** A registered, active license whose claim `token` this browser holds. */
async function createClaimedLicense(
  overrides: Partial<typeof awsMarketplaceLicense.$inferInsert> = {}
) {
  const licenseArn = uniqueArn()
  const token = generateId()
  const id = generateId()
  await db.insert(awsMarketplaceLicense).values({
    id,
    licenseArn,
    productCode: PRODUCT,
    customerIdentifier: 'customer-placeholder',
    status: 'active',
    dimension: 'enterprise',
    quantity: 25,
    lastVerifiedAt: new Date(),
    claimTokenHash: hashClaimToken(token),
    claimExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  })
  return { id, licenseArn, token }
}

function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('Expected the operation to be refused')
    },
    (error: unknown) => error
  )
}

beforeAll(() => {
  entitlementSend.mockImplementation(
    async (command: { input: { Filter: { LICENSE_ARN: string[] } } }) => {
      const answer = entitlementsByLicense.get(command.input.Filter.LICENSE_ARN[0])
      if (answer instanceof Error) throw answer
      return { Entitlements: answer ?? [] }
    }
  )
})

beforeEach(() => {
  meteringSend.mockReset()
  queueSend.mockReset()
  emailMailerMockFns.mockSendEmail.mockReset()
  emailMailerMockFns.mockSendEmail.mockResolvedValue({ success: true, message: 'sent' })
})

afterAll(async () => {
  await db
    .delete(awsMarketplaceLicense)
    .where(inArray(awsMarketplaceLicense.licenseArn, licenseArns))
  if (organizationIds.length) {
    await db.delete(organization).where(inArray(organization.id, organizationIds))
  }
  if (userIds.length) {
    await db.delete(auditLog).where(inArray(auditLog.actorId, userIds))
    await db.delete(user).where(inArray(user.id, userIds))
  }
})

describe('POST /api/marketplace/aws/register', () => {
  it('rejects a form without a registration token before calling AWS', async () => {
    const response = await registration('unrelated=1')

    expect(response.status).toBe(303)
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'invalid'
    )
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(meteringSend).not.toHaveBeenCalled()
  })

  it('rejects a token that resolves to another product without recording it', async () => {
    const licenseArn = uniqueArn()
    resolvesTo(licenseArn, 'other-product')

    const response = await registration('x-amzn-marketplace-token=opaque%2Btoken')

    expect(new URL(response.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'invalid'
    )
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await readLicense(licenseArn)).toBeUndefined()
    expect(meteringSend.mock.calls[0][0].input.RegistrationToken).toBe('opaque+token')
  })

  it('records an unentitled license as inactive and issues no claim', async () => {
    const licenseArn = uniqueArn()
    resolvesTo(licenseArn)
    entitlementsByLicense.set(licenseArn, [lapsedEntitlement()])

    const response = await registration('x-amzn-marketplace-token=lapsed-token')

    expect(new URL(response.headers.get('location') ?? '').searchParams.get('error')).toBe(
      'no-subscription'
    )
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await readLicense(licenseArn)).toMatchObject({
      status: 'inactive',
      claimTokenHash: null,
      claimExpiresAt: null,
    })
  })

  it('issues an httpOnly claim for an active license and stores only its hash', async () => {
    const licenseArn = uniqueArn()
    resolvesTo(licenseArn)
    entitlementsByLicense.set(licenseArn, [currentEntitlement()])

    const response = await registration('x-amzn-marketplace-token=active-token')

    const location = new URL(response.headers.get('location') ?? '')
    expect(response.status).toBe(303)
    expect(location.pathname).toBe('/marketplace/aws')
    expect(location.searchParams.get('error')).toBeNull()
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/Secure/)
    expect(cookie).toMatch(/SameSite=Lax/)
    const token = /sim_aws_marketplace_claim=([^;]+)/.exec(cookie)?.[1] ?? ''
    expect(token.length).toBeGreaterThan(20)
    const row = await readLicense(licenseArn)
    expect(row).toMatchObject({
      status: 'active',
      quantity: 25,
      claimTokenHash: hashClaimToken(token),
    })
    expect(row?.claimTokenHash).not.toBe(token)
    expect(row?.claimExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000)
  })
})

describe('linking a claimed license', () => {
  let ownerId: string
  let memberId: string
  let organizationId: string

  beforeAll(async () => {
    ownerId = await createUser()
    memberId = await createUser()
    organizationId = await createOrganization([
      { userId: ownerId, role: 'owner' },
      { userId: memberId, role: 'member' },
    ])
  })

  function link(userId: string, input: { licenseId: string; claimToken: string | null }) {
    return linkAwsMarketplaceLicense.execute({
      principal: createSessionPrincipal({ userId }),
      input: { organizationId, ...input },
    })
  }

  it('refuses a browser that holds no claim', async () => {
    const license = await createClaimedLicense()

    const error = await rejection(link(ownerId, { licenseId: license.id, claimToken: null }))

    expect(error).toMatchObject({ code: 'forbidden' })
    expect((await readLicense(license.licenseArn))?.organizationId).toBeNull()
  })

  it('refuses an expired claim', async () => {
    const license = await createClaimedLicense({ claimExpiresAt: new Date(Date.now() - 1000) })
    entitlementsByLicense.set(license.licenseArn, [currentEntitlement()])

    const error = await rejection(
      link(ownerId, { licenseId: license.id, claimToken: license.token })
    )

    expect(error).toMatchObject({ code: 'forbidden', message: expect.stringMatching(/expired/) })
    expect((await readLicense(license.licenseArn))?.organizationId).toBeNull()
  })

  it('refuses an organization member who is not an owner or admin', async () => {
    const license = await createClaimedLicense()
    entitlementsByLicense.set(license.licenseArn, [currentEntitlement()])

    const error = await rejection(
      link(memberId, { licenseId: license.id, claimToken: license.token })
    )

    expect(error).toMatchObject({ code: 'forbidden', detailCode: 'ORGANIZATION_ADMIN_REQUIRED' })
    expect(await readLicense(license.licenseArn)).toMatchObject({
      organizationId: null,
      claimTokenHash: hashClaimToken(license.token),
    })
  })

  it('refuses to move a license already linked to another organization', async () => {
    const otherOwnerId = await createUser()
    const otherOrganizationId = await createOrganization([{ userId: otherOwnerId, role: 'owner' }])
    const license = await createClaimedLicense({ organizationId: otherOrganizationId })
    entitlementsByLicense.set(license.licenseArn, [currentEntitlement()])

    const error = await rejection(
      link(ownerId, { licenseId: license.id, claimToken: license.token })
    )

    expect(error).toMatchObject({ code: 'conflict' })
    expect((await readLicense(license.licenseArn))?.organizationId).toBe(otherOrganizationId)
  })

  it('refuses when AWS no longer reports a current entitlement', async () => {
    const license = await createClaimedLicense()
    entitlementsByLicense.set(license.licenseArn, [lapsedEntitlement()])

    const error = await rejection(
      link(ownerId, { licenseId: license.id, claimToken: license.token })
    )

    expect(error).toMatchObject({ code: 'conflict' })
    expect(await readLicense(license.licenseArn)).toMatchObject({
      organizationId: null,
      status: 'inactive',
    })
    expect(emailMailerMockFns.mockSendEmail).not.toHaveBeenCalled()
  })

  it('links once, consumes the claim, audits the link, and notifies the team', async () => {
    const license = await createClaimedLicense()
    entitlementsByLicense.set(license.licenseArn, [
      currentEntitlement({ Value: { IntegerValue: 40 } }),
    ])

    await link(ownerId, { licenseId: license.id, claimToken: license.token })

    expect(await readLicense(license.licenseArn)).toMatchObject({
      organizationId,
      linkedByUserId: ownerId,
      quantity: 40,
      claimTokenHash: null,
      claimExpiresAt: null,
    })
    expect(emailMailerMockFns.mockSendEmail).toHaveBeenCalledTimes(1)
    expect(emailMailerMockFns.mockSendEmail.mock.calls[0][0].to).toEqual([
      expect.stringMatching(/^enterprise@/),
    ])
    await vi.waitFor(async () => {
      const entries = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.resourceId, license.id), eq(auditLog.actorId, ownerId)))
      expect(entries).toEqual([{ action: 'aws_marketplace_license.linked' }])
    })

    const replay = await rejection(
      link(ownerId, { licenseId: license.id, claimToken: license.token })
    )
    expect(replay).toMatchObject({ code: 'forbidden' })
    expect(emailMailerMockFns.mockSendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('registering a claimed license to an account', () => {
  let buyerId: string

  beforeAll(async () => {
    buyerId = await createUser()
  })

  function registerToAccount(input: { licenseId: string; claimToken: string | null }) {
    return registerAwsMarketplaceLicenseToAccount.execute({
      principal: createSessionPrincipal({ userId: buyerId }),
      input,
    })
  }

  it('registers to a buyer with no organization, consumes the claim, audits, and emails once', async () => {
    const license = await createClaimedLicense()
    entitlementsByLicense.set(license.licenseArn, [currentEntitlement()])

    await registerToAccount({ licenseId: license.id, claimToken: license.token })

    const row = await readLicense(license.licenseArn)
    expect(row).toMatchObject({
      organizationId: null,
      linkedByUserId: buyerId,
      claimTokenHash: null,
      claimExpiresAt: null,
    })
    expect(row?.linkedAt).toBeInstanceOf(Date)
    expect(emailMailerMockFns.mockSendEmail).toHaveBeenCalledTimes(1)
    expect(emailMailerMockFns.mockSendEmail.mock.calls[0][0]).toMatchObject({
      to: [expect.stringMatching(/^enterprise@/)],
      text: expect.stringMatching(/no organization yet/),
    })
    await vi.waitFor(async () => {
      const entries = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.resourceId, license.id), eq(auditLog.actorId, buyerId)))
      expect(entries).toEqual([{ action: 'aws_marketplace_license.registered' }])
    })

    const replay = await rejection(
      registerToAccount({ licenseId: license.id, claimToken: license.token })
    )
    expect(replay).toMatchObject({ code: 'forbidden' })
    expect(emailMailerMockFns.mockSendEmail).toHaveBeenCalledTimes(1)
  })

  it('refuses a browser that holds no claim', async () => {
    const license = await createClaimedLicense()

    const error = await rejection(registerToAccount({ licenseId: license.id, claimToken: null }))

    expect(error).toMatchObject({ code: 'forbidden' })
    expect((await readLicense(license.licenseArn))?.linkedByUserId).toBeNull()
  })

  it('refuses an expired claim', async () => {
    const license = await createClaimedLicense({ claimExpiresAt: new Date(Date.now() - 1000) })
    entitlementsByLicense.set(license.licenseArn, [currentEntitlement()])

    const error = await rejection(
      registerToAccount({ licenseId: license.id, claimToken: license.token })
    )

    expect(error).toMatchObject({ code: 'forbidden', message: expect.stringMatching(/expired/) })
    expect((await readLicense(license.licenseArn))?.linkedByUserId).toBeNull()
  })

  it('refuses when AWS no longer reports a current entitlement', async () => {
    const license = await createClaimedLicense()
    entitlementsByLicense.set(license.licenseArn, [lapsedEntitlement()])

    const error = await rejection(
      registerToAccount({ licenseId: license.id, claimToken: license.token })
    )

    expect(error).toMatchObject({ code: 'conflict' })
    expect(await readLicense(license.licenseArn)).toMatchObject({
      linkedByUserId: null,
      status: 'inactive',
      claimTokenHash: hashClaimToken(license.token),
    })
    expect(emailMailerMockFns.mockSendEmail).not.toHaveBeenCalled()
  })

  it('refuses a license already linked to an organization', async () => {
    const ownerId = await createUser()
    const organizationId = await createOrganization([{ userId: ownerId, role: 'owner' }])
    const license = await createClaimedLicense({ organizationId, linkedByUserId: ownerId })
    entitlementsByLicense.set(license.licenseArn, [currentEntitlement()])

    const error = await rejection(
      registerToAccount({ licenseId: license.id, claimToken: license.token })
    )

    expect(error).toMatchObject({ code: 'conflict' })
    expect(await readLicense(license.licenseArn)).toMatchObject({
      organizationId,
      linkedByUserId: ownerId,
    })
  })

  it('lets a license registered to an account be linked to an organization later', async () => {
    const license = await createClaimedLicense()
    entitlementsByLicense.set(license.licenseArn, [currentEntitlement()])
    await registerToAccount({ licenseId: license.id, claimToken: license.token })

    resolvesTo(license.licenseArn)
    const response = await registration('x-amzn-marketplace-token=second-visit')
    const token =
      /sim_aws_marketplace_claim=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ??
      null
    expect(token).not.toBeNull()
    const organizationId = await createOrganization([{ userId: buyerId, role: 'owner' }])

    await linkAwsMarketplaceLicense.execute({
      principal: createSessionPrincipal({ userId: buyerId }),
      input: { organizationId, licenseId: license.id, claimToken: token },
    })

    expect(await readLicense(license.licenseArn)).toMatchObject({
      organizationId,
      linkedByUserId: buyerId,
      claimTokenHash: null,
    })
    expect(emailMailerMockFns.mockSendEmail).toHaveBeenCalledTimes(2)
  })
})

describe('reconcileAwsMarketplaceLicenses', () => {
  it('discards poison events, keeps a throttled one for redelivery, and marks lapsed licenses inactive', async () => {
    const eventArn = uniqueArn()
    const throttledArn = uniqueArn()
    const staleArn = uniqueArn()
    await db.insert(awsMarketplaceLicense).values([
      {
        id: generateId(),
        licenseArn: eventArn,
        productCode: PRODUCT,
        customerIdentifier: 'customer-placeholder',
        status: 'active',
        lastVerifiedAt: new Date(Date.now() - 60_000),
      },
      {
        id: generateId(),
        licenseArn: staleArn,
        productCode: PRODUCT,
        customerIdentifier: 'customer-placeholder',
        status: 'active',
        dimension: 'enterprise',
        lastVerifiedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    ])
    entitlementsByLicense.set(eventArn, [lapsedEntitlement()])
    entitlementsByLicense.set(throttledArn, throttled())
    entitlementsByLicense.set(staleArn, [])

    const licenseEvent = (arn: string, productCode = PRODUCT) =>
      JSON.stringify({
        source: 'aws.agreement-marketplace',
        'detail-type': 'License Deprovisioned - Manufacturer',
        detail: { license: { arn }, product: { code: productCode } },
      })
    const messages = [
      { MessageId: 'malformed', ReceiptHandle: 'r-malformed', Body: '{not json' },
      { MessageId: 'foreign', ReceiptHandle: 'r-foreign', Body: licenseEvent(eventArn, 'other') },
      { MessageId: 'throttled', ReceiptHandle: 'r-throttled', Body: licenseEvent(throttledArn) },
      { MessageId: 'lapsed', ReceiptHandle: 'r-lapsed', Body: licenseEvent(eventArn) },
    ]
    let delivered = false
    queueSend.mockImplementation(async (command: { kind: string }) => {
      if (command.kind === 'receive') {
        if (delivered) return { Messages: [] }
        delivered = true
        return { Messages: messages }
      }
      return {}
    })

    const summary = await reconcileAwsMarketplaceLicenses()

    const deleted = queueSend.mock.calls
      .map(([command]) => command)
      .filter((command) => command.kind === 'delete')
      .map((command) => command.input.ReceiptHandle)
    expect(deleted.sort()).toEqual(['r-foreign', 'r-lapsed', 'r-malformed'])
    expect(summary).toMatchObject({ received: 4, applied: 1, discarded: 2, retained: 1 })
    expect((await readLicense(eventArn))?.status).toBe('inactive')
    expect(await readLicense(throttledArn)).toBeUndefined()
    const stale = await readLicense(staleArn)
    expect(stale).toMatchObject({ status: 'inactive', dimension: 'enterprise' })
    expect(stale?.lastVerifiedAt.getTime()).toBeGreaterThan(Date.now() - 60_000)
  })
})
