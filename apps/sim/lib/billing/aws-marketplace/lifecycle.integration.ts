import type { Entitlement } from '@aws-sdk/client-marketplace-entitlement-service'
import { db } from '@sim/db'
import {
  auditLog,
  awsMarketplaceLicense,
  member,
  organization,
  outboxEvent,
  user,
} from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { emailMailerMock, emailMailerMockFns } from '@sim/testing/mocks/email-mailer.mock'
import { requestUtilsMock, requestUtilsMockFns } from '@sim/testing/mocks/request.mock'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const PRODUCT = 'product-placeholder'
/** New SaaS products: ResolveCustomer names the buyer by account ID, never `CustomerIdentifier`. */
const ACCOUNT = '000000000000'
const AGREEMENT = 'agmt-placeholder'
const CONTACT = { contactEmail: 'buyer@example.test', companyName: 'Example Co' }

const { meteringSend, entitlementSend, queueSend } = vi.hoisted(() => {
  process.env.AWS_MARKETPLACE_PRODUCT_CODE = 'product-placeholder'
  process.env.AWS_MARKETPLACE_EVENTS_QUEUE_URL =
    'https://queue.example.test/aws-marketplace-placeholder'
  process.env.ADMIN_API_KEY = 'admin-key-placeholder'
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
  ChangeMessageVisibilityCommand: class {
    readonly kind = 'extend'
    constructor(public input: { ReceiptHandle: string }) {}
  },
}))
vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)
vi.mock('@/lib/core/utils/request', () => requestUtilsMock)

import {
  linkAwsMarketplaceLicense,
  listAccountAwsMarketplaceLicenses,
  listOrganizationAwsMarketplaceLicenses,
  readAwsMarketplaceClaim,
  registerAwsMarketplaceLicenseToAccount,
  saveAwsMarketplaceClaimContact,
} from '@/lib/billing/aws-marketplace/application/use-cases'
import { hashClaimToken } from '@/lib/billing/aws-marketplace/claim'
import {
  AWS_MARKETPLACE_BUYER_NOTICE_EVENT,
  AWS_MARKETPLACE_TEAM_NOTICE_EVENT,
} from '@/lib/billing/aws-marketplace/notice-events'
import { awsMarketplaceOutboxHandlers } from '@/lib/billing/aws-marketplace/notifications'
import { reconcileAwsMarketplaceLicenses } from '@/lib/billing/aws-marketplace/reconcile'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import { POST as register, GET as revisit } from '@/app/api/marketplace/aws/register/route'
import {
  POST as adminLink,
  GET as adminList,
} from '@/app/api/v1/admin/dashboard/aws-marketplace-licenses/route'

const NOTICE_EVENTS = [AWS_MARKETPLACE_TEAM_NOTICE_EVENT, AWS_MARKETPLACE_BUYER_NOTICE_EVENT]
const DAY_MS = 24 * 60 * 60 * 1000
const TEAM = /^enterprise@/
const BUYER = /^buyer@example\.test$/
const CANCEL_CALL = /POST \/api\/v1\/admin\/dashboard\/organizations\/<id>\/cancellation/

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

function uniqueAccount(): string {
  return generateId().replace(/\D/g, '').padEnd(12, '7').slice(0, 12)
}

function uniqueAgreement(): string {
  return `agmt-${generateId()}`
}

function currentEntitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    ProductCode: PRODUCT,
    Dimension: 'enterprise',
    CustomerAWSAccountId: ACCOUNT,
    Value: { IntegerValue: 25 },
    ExpirationDate: new Date(Date.now() + 365 * DAY_MS),
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
  requestUtilsMockFns.mockGetClientIp.mockReturnValue(`198.51.100.${licenseArns.length % 250}`)
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
    CustomerAWSAccountId: ACCOUNT,
    ProductCode: productCode,
    LicenseArn: licenseArn,
    Metadata: { AgreementId: AGREEMENT },
  })
}

function errorOf(response: Response): string | null {
  return new URL(response.headers.get('location') ?? '').searchParams.get('error')
}

function claimTokenOf(response: Response): string | null {
  return (
    /sim_aws_marketplace_claim=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? null
  )
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

async function insertLicense(overrides: Partial<typeof awsMarketplaceLicense.$inferInsert> = {}) {
  const licenseArn = overrides.licenseArn ?? uniqueArn()
  const id = generateId()
  const lastVerifiedAt = overrides.lastVerifiedAt ?? new Date()
  await db.insert(awsMarketplaceLicense).values({
    id,
    licenseArn,
    productCode: PRODUCT,
    customerAwsAccountId: ACCOUNT,
    status: 'active',
    dimension: 'enterprise',
    quantity: 25,
    lastVerifiedAt,
    lastVerificationAttemptAt: lastVerifiedAt,
    ...overrides,
  })
  return { id, licenseArn }
}

/** A registered, active license whose claim `token` this browser holds. */
async function createClaimedLicense(
  overrides: Partial<typeof awsMarketplaceLicense.$inferInsert> = {}
) {
  const token = generateId()
  const license = await insertLicense({
    claimTokenHash: hashClaimToken(token),
    claimExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  })
  return { ...license, token }
}

async function pendingNoticeIds(): Promise<string[]> {
  const rows = await db
    .select({ id: outboxEvent.id })
    .from(outboxEvent)
    .where(and(inArray(outboxEvent.eventType, NOTICE_EVENTS), eq(outboxEvent.status, 'pending')))
    .orderBy(asc(outboxEvent.createdAt))
  return rows.map((row) => row.id)
}

interface SentEmail {
  to: string[]
  subject: string
  text: string
}

/** Runs every queued notice through the outbox handlers, then reads what reached the mailer. */
async function emailsTo(to: RegExp): Promise<SentEmail[]> {
  for (const id of await pendingNoticeIds()) {
    await processOutboxEventById(id, awsMarketplaceOutboxHandlers)
  }
  return emailMailerMockFns.mockSendEmail.mock.calls
    .map(([email]) => email as SentEmail)
    .filter((email) => email.to.some((address) => to.test(address)))
}

function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('Expected the operation to be refused')
    },
    (error: unknown) => error
  )
}

/** One batch of `events`, then an empty queue; returns the receipt handles deleted. */
function deliverOnce(events: Array<Record<string, unknown>>) {
  const deleted: string[] = []
  let delivered = false
  queueSend.mockImplementation(
    async (command: { kind: string; input: { ReceiptHandle: string } }) => {
      if (command.kind === 'delete') {
        deleted.push(command.input.ReceiptHandle)
        return {}
      }
      if (command.kind === 'extend') return {}
      if (delivered) return { Messages: [] }
      delivered = true
      return {
        Messages: events.map((event, index) => ({
          MessageId: `m-${generateId()}`,
          ReceiptHandle: `r-${index}`,
          Body: JSON.stringify({ source: 'aws.agreement-marketplace', ...event }),
        })),
      }
    }
  )
  return deleted
}

function licenseUpdated(licenseArn: string, agreementId?: string, time?: Date) {
  return {
    'detail-type': 'License Updated - Manufacturer',
    ...(time && { time: time.toISOString() }),
    detail: {
      license: { arn: licenseArn },
      product: { code: PRODUCT },
      ...(agreementId && { agreement: { id: agreementId } }),
    },
  }
}

function agreementCreated(agreementId: string, previousAgreementId?: string) {
  return {
    'detail-type': 'Purchase Agreement Created - Proposer',
    detail: { agreement: { id: agreementId, previousAgreementId } },
  }
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

beforeEach(async () => {
  meteringSend.mockReset()
  queueSend.mockReset()
  entitlementSend.mockClear()
  emailMailerMockFns.mockSendEmail.mockReset()
  emailMailerMockFns.mockSendEmail.mockResolvedValue({ success: true, message: 'sent' })
  await db.delete(outboxEvent).where(inArray(outboxEvent.eventType, NOTICE_EVENTS))
})

afterAll(async () => {
  await db.delete(outboxEvent).where(inArray(outboxEvent.eventType, NOTICE_EVENTS))
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
    expect(errorOf(response)).toBe('invalid')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(meteringSend).not.toHaveBeenCalled()
  })

  it('answers a rate-limited browser with a redirect, not raw JSON', async () => {
    requestUtilsMockFns.mockGetClientIp.mockReturnValueOnce(null)

    const limited = await register(
      new NextRequest('http://localhost:3000/api/marketplace/aws/register', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'x-amzn-marketplace-token=any',
      }),
      {}
    )

    expect(limited.status).toBe(303)
    expect(errorOf(limited)).toBe('unavailable')
  })

  it('rejects a token that resolves to another product without recording it', async () => {
    const licenseArn = uniqueArn()
    resolvesTo(licenseArn, 'other-product')

    const response = await registration('x-amzn-marketplace-token=opaque%2Btoken')

    expect(errorOf(response)).toBe('invalid')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await readLicense(licenseArn)).toBeUndefined()
    expect(meteringSend.mock.calls[0][0].input.RegistrationToken).toBe('opaque+token')
  })

  it('records a lapsed license as inactive and issues no claim', async () => {
    const licenseArn = uniqueArn()
    resolvesTo(licenseArn)
    entitlementsByLicense.set(licenseArn, [lapsedEntitlement()])

    const response = await registration('x-amzn-marketplace-token=lapsed-token')

    expect(errorOf(response)).toBe('no-subscription')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await readLicense(licenseArn)).toMatchObject({
      status: 'inactive',
      claimTokenHash: null,
      claimExpiresAt: null,
    })
  })

  it('issues an httpOnly four-hour claim for an active license and stores only its hash', async () => {
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
    const token = claimTokenOf(response) ?? ''
    expect(token.length).toBeGreaterThan(20)
    const row = await readLicense(licenseArn)
    expect(row).toMatchObject({
      status: 'active',
      quantity: 25,
      claimTokenHash: hashClaimToken(token),
    })
    const remaining = (row?.claimExpiresAt?.getTime() ?? 0) - Date.now()
    expect(remaining).toBeGreaterThan(3.9 * 60 * 60 * 1000)
    expect(remaining).toBeLessThanOrEqual(4 * 60 * 60 * 1000)
  })

  it('registers a new-product buyer named by account ID alone, and tells the team at once', async () => {
    const licenseArn = uniqueArn()
    resolvesTo(licenseArn)
    entitlementsByLicense.set(licenseArn, [currentEntitlement()])

    const response = await registration('x-amzn-marketplace-token=new-product-token')

    expect(claimTokenOf(response)).not.toBeNull()
    expect(await readLicense(licenseArn)).toMatchObject({
      status: 'active',
      customerAwsAccountId: ACCOUNT,
      agreementId: AGREEMENT,
    })
    expect(await emailsTo(TEAM)).toEqual([
      expect.objectContaining({
        subject: expect.stringMatching(/New license/),
        text: expect.stringMatching(/may not finish it[\s\S]*not received yet/),
      }),
    ])
  })

  it('does not let an older read restore a license a newer read lapsed', async () => {
    const { licenseArn } = await insertLicense({
      status: 'inactive',
      lastVerifiedAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    resolvesTo(licenseArn)
    entitlementsByLicense.set(licenseArn, [currentEntitlement()])

    const response = await registration('x-amzn-marketplace-token=slow-token')

    expect(errorOf(response)).toBe('no-subscription')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await readLicense(licenseArn)).toMatchObject({
      status: 'inactive',
      claimTokenHash: null,
    })
  })

  it('tells the team when a registration read moves an existing license’s terms', async () => {
    const { licenseArn } = await insertLicense({ quantity: 10 })
    resolvesTo(licenseArn)
    entitlementsByLicense.set(licenseArn, [currentEntitlement({ Value: { IntegerValue: 40 } })])

    await registration('x-amzn-marketplace-token=moved-token')

    expect(await emailsTo(TEAM)).toEqual([
      expect.objectContaining({ text: expect.stringMatching(/quantity 10[\s\S]*quantity 40/) }),
    ])
  })

  it('sends a buyer whose agreement has not started back on its start date, saving nothing', async () => {
    const account = uniqueAccount()
    meteringSend.mockResolvedValueOnce({ CustomerAWSAccountId: account, ProductCode: PRODUCT })

    const response = await registration('x-amzn-marketplace-token=future-dated-token')

    expect(errorOf(response)).toBe('not-started')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(entitlementSend).not.toHaveBeenCalled()
    expect(
      await db
        .select({ id: awsMarketplaceLicense.id })
        .from(awsMarketplaceLicense)
        .where(eq(awsMarketplaceLicense.customerAwsAccountId, account))
    ).toEqual([])
  })

  it('sends a refreshed or bookmarked fulfillment URL to the onboarding page', async () => {
    const response = await revisit(
      new NextRequest('http://localhost:3000/api/marketplace/aws/register'),
      {}
    )

    expect(response.status).toBe(303)
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/marketplace/aws')
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})

describe('a license AWS has not confirmed yet', () => {
  it('holds a claim, takes contact details, refuses a take, and proceeds once AWS confirms', async () => {
    const buyerId = await createUser()
    const principal = createSessionPrincipal({ userId: buyerId })
    const licenseArn = uniqueArn()
    resolvesTo(licenseArn)
    entitlementsByLicense.set(licenseArn, [])

    const response = await registration('x-amzn-marketplace-token=early-token')

    const claimToken = claimTokenOf(response)
    expect(claimToken).not.toBeNull()
    const row = await readLicense(licenseArn)
    expect(row).toMatchObject({ status: 'pending', linkedByUserId: null })
    expect(await emailsTo(TEAM)).toEqual([
      expect.objectContaining({ text: expect.stringMatching(/Unconfirmed/) }),
    ])

    expect(
      await readAwsMarketplaceClaim.execute({ principal, input: { claimToken } })
    ).toMatchObject({ status: 'pending' })
    const refused = await rejection(
      registerAwsMarketplaceLicenseToAccount.execute({
        principal,
        input: { ...CONTACT, licenseId: row.id, claimToken },
      })
    )
    expect(refused).toMatchObject({
      code: 'conflict',
      message: expect.stringMatching(/still confirming/),
    })
    expect((await readLicense(licenseArn))?.claimTokenHash).not.toBeNull()

    expect(
      await saveAwsMarketplaceClaimContact.execute({
        principal,
        input: { ...CONTACT, licenseId: row.id, claimToken },
      })
    ).toEqual({ status: 'pending' })
    expect(await readLicense(licenseArn)).toMatchObject({
      contactEmail: CONTACT.contactEmail,
      linkedByUserId: null,
    })
    await emailsTo(TEAM)

    emailMailerMockFns.mockSendEmail.mockClear()
    entitlementsByLicense.set(licenseArn, [currentEntitlement()])
    expect(
      await saveAwsMarketplaceClaimContact.execute({
        principal,
        input: { ...CONTACT, licenseId: row.id, claimToken },
      })
    ).toEqual({ status: 'active' })
    expect(await emailsTo(TEAM)).toEqual([
      expect.objectContaining({ subject: expect.stringMatching(/pending → active/) }),
    ])
    await registerAwsMarketplaceLicenseToAccount.execute({
      principal,
      input: { ...CONTACT, licenseId: row.id, claimToken },
    })
    expect((await readLicense(licenseArn))?.linkedByUserId).toBe(buyerId)
  })

  it('stays pending on a reverify, but a license once confirmed lapses', async () => {
    const pending = await insertLicense({
      status: 'pending',
      lastVerifiedAt: new Date(Date.now() - 2 * DAY_MS),
    })
    const confirmed = await insertLicense({
      claimTokenHash: hashClaimToken(generateId()),
      claimExpiresAt: new Date(Date.now() + 60_000),
      lastVerifiedAt: new Date(Date.now() - 2 * DAY_MS),
    })
    entitlementsByLicense.set(pending.licenseArn, [])
    entitlementsByLicense.set(confirmed.licenseArn, [])
    deliverOnce([])

    await reconcileAwsMarketplaceLicenses()

    expect((await readLicense(pending.licenseArn))?.status).toBe('pending')
    expect(await readLicense(confirmed.licenseArn)).toMatchObject({
      status: 'inactive',
      claimTokenHash: null,
    })
  })
})

describe('reading a claim', () => {
  it('shows a masked account, and says who holds a linked license only to its administrators', async () => {
    const adminId = await createUser()
    const strangerId = await createUser()
    const organizationId = await createOrganization([{ userId: adminId, role: 'admin' }])
    const open = await createClaimedLicense({ customerAwsAccountId: '123456781234' })
    const linked = await createClaimedLicense({ organizationId })
    const expired = await createClaimedLicense({ claimExpiresAt: new Date(Date.now() - 1000) })
    const read = (userId: string, claimToken: string) =>
      readAwsMarketplaceClaim.execute({
        principal: createSessionPrincipal({ userId }),
        input: { claimToken },
      })

    expect(await read(strangerId, open.token)).toMatchObject({
      status: 'ready',
      license: { awsAccount: '••••1234' },
    })
    expect(await read(adminId, linked.token)).toEqual({ status: 'linked', organizationId })
    expect(await read(strangerId, linked.token)).toEqual({ status: 'linked', organizationId: null })
    expect(await read(strangerId, expired.token)).toEqual({ status: 'missing' })
  })
})

describe('reading subscription status', () => {
  it('shows members only the licenses linked to their organization and refuses others', async () => {
    const memberId = await createUser()
    const outsiderId = await createUser()
    const organizationId = await createOrganization([{ userId: memberId, role: 'member' }])
    const otherOrganizationId = await createOrganization([{ userId: outsiderId, role: 'owner' }])
    const ours = await insertLicense({ organizationId })
    await insertLicense({ organizationId: otherOrganizationId })

    const licenses = await listOrganizationAwsMarketplaceLicenses.execute({
      principal: createSessionPrincipal({ userId: memberId }),
      input: { organizationId },
    })
    const refusal = await rejection(
      listOrganizationAwsMarketplaceLicenses.execute({
        principal: createSessionPrincipal({ userId: outsiderId }),
        input: { organizationId },
      })
    )

    expect(licenses).toEqual([expect.objectContaining({ id: ours.id, status: 'active' })])
    expect(refusal).toMatchObject({ code: 'not_found' })
  })

  it('shows a buyer the licenses registered to their account alone', async () => {
    const buyerId = await createUser()
    const otherId = await createUser()
    const organizationId = await createOrganization([{ userId: buyerId, role: 'owner' }])
    const registered = await insertLicense({ linkedByUserId: buyerId })
    await insertLicense({ linkedByUserId: buyerId, organizationId })
    await insertLicense({ linkedByUserId: otherId })

    const licenses = await listAccountAwsMarketplaceLicenses.execute({
      principal: createSessionPrincipal({ userId: buyerId }),
      input: {},
    })

    expect(licenses).toEqual([expect.objectContaining({ id: registered.id })])
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
      input: { ...CONTACT, organizationId, ...input },
    })
  }

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

  it('links under a newer active read without overwriting it with its own older one', async () => {
    const license = await createClaimedLicense({ lastVerifiedAt: new Date(Date.now() + 60_000) })
    entitlementsByLicense.set(license.licenseArn, [
      currentEntitlement({ Value: { IntegerValue: 40 } }),
    ])

    await link(ownerId, { licenseId: license.id, claimToken: license.token })

    expect(await readLicense(license.licenseArn)).toMatchObject({
      organizationId,
      quantity: 25,
      claimTokenHash: null,
    })
  })

  it('takes a claim at most once when two tabs race it on Postgres', async () => {
    const license = await createClaimedLicense()
    entitlementsByLicense.set(license.licenseArn, [
      currentEntitlement({ ExpirationDate: undefined }),
    ])
    const take = () => link(ownerId, { licenseId: license.id, claimToken: license.token })

    const results = await Promise.allSettled([take(), take()])

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(await readLicense(license.licenseArn)).toMatchObject({
      organizationId,
      claimTokenHash: null,
    })
    expect(await emailsTo(TEAM)).toHaveLength(1)
    expect(await emailsTo(BUYER)).toHaveLength(1)
  })

  it('links once, consumes the claim, audits it, and queues both notices with their terms', async () => {
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
      contactEmail: CONTACT.contactEmail,
      companyName: CONTACT.companyName,
    })
    const team = await emailsTo(TEAM)
    expect(team.map((email) => email.subject)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/active → active/),
        expect.stringMatching(/Linked to an organization/),
      ])
    )
    const linkNotice = team.find((email) => /Linked to an organization/.test(email.subject))
    expect(linkNotice?.text).toMatch(/Company: Example Co/)
    expect(linkNotice?.text).toMatch(/pausePaymentCollection: true/)
    expect(linkNotice?.text).toMatch(/Never send a Stripe invoice/)
    expect(await emailsTo(BUYER)).toEqual([
      expect.objectContaining({
        text: expect.stringMatching(
          /being set up\. Please wait for us to contact you\. We expect to finish within 2 business days\.[\s\S]*Questions\? Contact \S+@\S+/
        ),
      }),
    ])
    await vi.waitFor(async () => {
      const entries = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.resourceId, license.id), eq(auditLog.actorId, ownerId)))
      expect(entries).toEqual([{ action: 'aws_marketplace_license.linked' }])
    })
  })
})

describe.each([
  {
    take: 'linking',
    run: async (input: { licenseId: string; claimToken: string | null }) => {
      const userId = await createUser()
      const organizationId = await createOrganization([{ userId, role: 'owner' }])
      return linkAwsMarketplaceLicense.execute({
        principal: createSessionPrincipal({ userId }),
        input: { ...CONTACT, organizationId, ...input },
      })
    },
  },
  {
    take: 'registering',
    run: async (input: { licenseId: string; claimToken: string | null }) =>
      registerAwsMarketplaceLicenseToAccount.execute({
        principal: createSessionPrincipal({ userId: await createUser() }),
        input: { ...CONTACT, ...input },
      }),
  },
])('$take refuses', ({ run }) => {
  it('a browser that holds no claim', async () => {
    const license = await createClaimedLicense()

    const error = await rejection(run({ licenseId: license.id, claimToken: null }))

    expect(error).toMatchObject({ code: 'forbidden' })
    expect((await readLicense(license.licenseArn))?.linkedByUserId).toBeNull()
  })

  it('an expired claim', async () => {
    const license = await createClaimedLicense({ claimExpiresAt: new Date(Date.now() - 1000) })
    entitlementsByLicense.set(license.licenseArn, [currentEntitlement()])

    const error = await rejection(run({ licenseId: license.id, claimToken: license.token }))

    expect(error).toMatchObject({ code: 'forbidden', message: expect.stringMatching(/expired/) })
    expect((await readLicense(license.licenseArn))?.linkedByUserId).toBeNull()
  })

  it('a lapsed license, clearing its claim and telling only the team', async () => {
    const license = await createClaimedLicense()
    entitlementsByLicense.set(license.licenseArn, [lapsedEntitlement()])

    const error = await rejection(run({ licenseId: license.id, claimToken: license.token }))

    expect(error).toMatchObject({ code: 'conflict' })
    expect(await readLicense(license.licenseArn)).toMatchObject({
      linkedByUserId: null,
      status: 'inactive',
      claimTokenHash: null,
    })
    expect(await emailsTo(BUYER)).toEqual([])
    expect(await emailsTo(TEAM)).toEqual([
      expect.objectContaining({ subject: expect.stringMatching(/active → inactive/) }),
    ])
  })

  it('an active read older than a newer read that still says pending', async () => {
    const license = await createClaimedLicense({
      status: 'pending',
      lastVerifiedAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    entitlementsByLicense.set(license.licenseArn, [currentEntitlement()])

    const error = await rejection(run({ licenseId: license.id, claimToken: license.token }))

    expect(error).toMatchObject({ code: 'conflict', message: expect.stringMatching(/confirming/) })
    expect(await readLicense(license.licenseArn)).toMatchObject({
      linkedByUserId: null,
      status: 'pending',
      claimTokenHash: hashClaimToken(license.token),
    })
    expect(await emailsTo(/./)).toEqual([])
  })
})

describe('registering a claimed license to an account', () => {
  let buyerId: string

  beforeAll(async () => {
    buyerId = await createUser()
  })

  function registerToAccount(input: {
    licenseId: string
    claimToken: string | null
    contactEmail?: string
  }) {
    return registerAwsMarketplaceLicenseToAccount.execute({
      principal: createSessionPrincipal({ userId: buyerId }),
      input: { ...CONTACT, ...input },
    })
  }

  it('registers to a buyer with no organization, consumes the claim, audits, and tells both', async () => {
    const license = await createClaimedLicense()
    entitlementsByLicense.set(license.licenseArn, [
      currentEntitlement({ ExpirationDate: undefined }),
    ])

    await registerToAccount({ licenseId: license.id, claimToken: license.token })

    expect(await readLicense(license.licenseArn)).toMatchObject({
      organizationId: null,
      linkedByUserId: buyerId,
      claimTokenHash: null,
      claimExpiresAt: null,
    })
    expect(await emailsTo(TEAM)).toEqual([
      expect.objectContaining({ text: expect.stringMatching(/no organization yet/) }),
    ])
    expect(await emailsTo(BUYER)).toEqual([
      expect.objectContaining({ text: expect.stringMatching(/within 2 business days/) }),
    ])
    await vi.waitFor(async () => {
      const entries = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.resourceId, license.id), eq(auditLog.actorId, buyerId)))
      expect(entries).toEqual([{ action: 'aws_marketplace_license.registered' }])
    })
  })

  it('tells the team when a re-registration changes the contact details, and only then', async () => {
    const license = await createClaimedLicense()
    entitlementsByLicense.set(license.licenseArn, [currentEntitlement()])
    await registerToAccount({ licenseId: license.id, claimToken: license.token })
    const contactNotices = async () =>
      (await emailsTo(TEAM)).filter((email) => /Buyer contact/.test(email.subject))
    const reclaim = async (token: string) => {
      resolvesTo(license.licenseArn)
      return claimTokenOf(await registration(`x-amzn-marketplace-token=${token}`))
    }

    await registerToAccount({ licenseId: license.id, claimToken: await reclaim('same-contact') })
    expect(await contactNotices()).toEqual([])

    await registerToAccount({
      licenseId: license.id,
      claimToken: await reclaim('new-contact'),
      contactEmail: 'new-contact@example.test',
    })

    expect(await contactNotices()).toEqual([
      expect.objectContaining({ text: expect.stringMatching(/new-contact@example\.test/) }),
    ])
    expect((await readLicense(license.licenseArn))?.contactEmail).toBe('new-contact@example.test')
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
    const token = claimTokenOf(response)
    expect(token).not.toBeNull()
    const organizationId = await createOrganization([{ userId: buyerId, role: 'owner' }])

    await linkAwsMarketplaceLicense.execute({
      principal: createSessionPrincipal({ userId: buyerId }),
      input: { ...CONTACT, organizationId, licenseId: license.id, claimToken: token },
    })

    expect(await readLicense(license.licenseArn)).toMatchObject({
      organizationId,
      linkedByUserId: buyerId,
      claimTokenHash: null,
    })
  })
})

describe('notice delivery', () => {
  it('retries a failed send through the outbox without losing the notice', async () => {
    const license = await createClaimedLicense()
    entitlementsByLicense.set(license.licenseArn, [currentEntitlement()])
    await registerAwsMarketplaceLicenseToAccount.execute({
      principal: createSessionPrincipal({ userId: await createUser() }),
      input: { ...CONTACT, licenseId: license.id, claimToken: license.token },
    })
    emailMailerMockFns.mockSendEmail.mockResolvedValueOnce({ success: false, message: 'down' })
    const [teamNotice] = await pendingNoticeIds()

    expect(await processOutboxEventById(teamNotice, awsMarketplaceOutboxHandlers)).toBe('pending')
    await db
      .update(outboxEvent)
      .set({ availableAt: new Date(Date.now() - 1000) })
      .where(eq(outboxEvent.id, teamNotice))
    expect(await processOutboxEventById(teamNotice, awsMarketplaceOutboxHandlers)).toBe('completed')

    expect(emailMailerMockFns.mockSendEmail).toHaveBeenCalledTimes(2)
  })
})

describe('reconcileAwsMarketplaceLicenses', () => {
  it('discards poison events, keeps a throttled one for redelivery, and marks lapsed licenses inactive', async () => {
    const event = await insertLicense({ lastVerifiedAt: new Date(Date.now() - 60_000) })
    const throttledArn = uniqueArn()
    const stale = await insertLicense({ lastVerifiedAt: new Date(Date.now() - 2 * DAY_MS) })
    entitlementsByLicense.set(event.licenseArn, [lapsedEntitlement()])
    entitlementsByLicense.set(throttledArn, throttled())
    entitlementsByLicense.set(stale.licenseArn, [])
    const deprovisioned = (arn: string, productCode = PRODUCT) => ({
      'detail-type': 'License Deprovisioned - Manufacturer',
      detail: { license: { arn }, product: { code: productCode } },
    })
    const deleted = deliverOnce([
      { source: 'not-marketplace' },
      deprovisioned(event.licenseArn, 'other'),
      deprovisioned(throttledArn),
      deprovisioned(event.licenseArn),
    ])

    const summary = await reconcileAwsMarketplaceLicenses()

    expect(deleted.sort()).toEqual(['r-0', 'r-1', 'r-3'])
    expect(summary).toMatchObject({ received: 4, applied: 1, discarded: 2, retained: 1 })
    expect((await readLicense(event.licenseArn))?.status).toBe('inactive')
    expect(await readLicense(throttledArn)).toBeUndefined()
    const staleRow = await readLicense(stale.licenseArn)
    expect(staleRow).toMatchObject({ status: 'inactive', dimension: 'enterprise' })
    expect(staleRow?.lastVerifiedAt.getTime()).toBeGreaterThan(Date.now() - 60_000)
    const notices = await emailsTo(TEAM)
    expect(notices.map((email) => email.subject)).toEqual([
      expect.stringMatching(/active → inactive/),
      expect.stringMatching(/active → inactive/),
    ])
  })

  it('gives the cancel instruction and its required body only when an organization holds the lapsed license', async () => {
    const organizationId = await createOrganization([{ userId: await createUser(), role: 'owner' }])
    const linked = await insertLicense({ organizationId })
    const unlinked = await insertLicense()
    entitlementsByLicense.set(linked.licenseArn, [lapsedEntitlement()])
    entitlementsByLicense.set(unlinked.licenseArn, [lapsedEntitlement()])
    deliverOnce(
      [linked, unlinked].map(({ licenseArn }) => ({
        'detail-type': 'License Deprovisioned - Manufacturer',
        detail: { license: { arn: licenseArn }, product: { code: PRODUCT } },
      }))
    )

    await reconcileAwsMarketplaceLicenses()

    const notices = await emailsTo(TEAM)
    const noticeOf = ({ id }: { id: string }) =>
      notices.find((email) => email.text.includes(`License ID: ${id}`))?.text
    expect(noticeOf(linked)).toMatch(CANCEL_CALL)
    expect(noticeOf(linked)).toMatch(/\(operationId: a new UUID, timing: immediate\)/)
    expect(noticeOf(unlinked)).not.toMatch(CANCEL_CALL)
    expect(noticeOf(unlinked)).toMatch(
      /No organization holds this license\. If you provisioned one for this buyer, cancel it there\./
    )
  })

  it('does not tell the team to cancel when a retried notice arrives after the license recovered', async () => {
    const organizationId = await createOrganization([{ userId: await createUser(), role: 'owner' }])
    const license = await insertLicense({ organizationId })
    const event = {
      'detail-type': 'License Updated - Manufacturer',
      detail: { license: { arn: license.licenseArn }, product: { code: PRODUCT } },
    }
    entitlementsByLicense.set(license.licenseArn, [lapsedEntitlement()])
    deliverOnce([event])
    await reconcileAwsMarketplaceLicenses()
    entitlementsByLicense.set(license.licenseArn, [currentEntitlement()])
    deliverOnce([event])
    await reconcileAwsMarketplaceLicenses()

    const notices = await emailsTo(TEAM)

    expect(notices.length).toBeGreaterThan(1)
    for (const notice of notices) expect(notice.text).not.toMatch(CANCEL_CALL)
  })

  it('does not ask the team to provision a license that lapsed before setup', async () => {
    const licenseArn = uniqueArn()
    entitlementsByLicense.set(licenseArn, [lapsedEntitlement()])
    deliverOnce([
      {
        'detail-type': 'License Updated - Manufacturer',
        detail: {
          license: { arn: licenseArn },
          product: { code: PRODUCT },
          acceptor: { accountId: ACCOUNT },
        },
      },
    ])

    await reconcileAwsMarketplaceLicenses()

    const [notice] = await emailsTo(TEAM)
    expect(notice.text).toMatch(/Do not provision this license/)
    expect(notice.text).not.toMatch(/pausePaymentCollection/)
  })

  it('re-verifies only the configured product', async () => {
    const longAgo = new Date(Date.now() - 3 * DAY_MS)
    const other = await insertLicense({
      productCode: 'another-product',
      lastVerifiedAt: longAgo,
      lastVerificationAttemptAt: longAgo,
    })
    entitlementsByLicense.set(other.licenseArn, [lapsedEntitlement()])
    queueSend.mockResolvedValue({ Messages: [] })

    await reconcileAwsMarketplaceLicenses()

    expect((await readLicense(other.licenseArn))?.lastVerificationAttemptAt).toEqual(longAgo)
  })

  it('sends the team nothing when a re-verify finds the same terms', async () => {
    const expiresAt = new Date(Date.now() + 30 * DAY_MS)
    const { licenseArn } = await insertLicense({
      expiresAt,
      lastVerifiedAt: new Date(Date.now() - 2 * DAY_MS),
    })
    entitlementsByLicense.set(licenseArn, [currentEntitlement({ ExpirationDate: expiresAt })])
    deliverOnce([])

    const summary = await reconcileAwsMarketplaceLicenses()

    expect(summary).toMatchObject({ reverified: 1 })
    expect((await readLicense(licenseArn))?.lastVerifiedAt.getTime()).toBeGreaterThan(
      Date.now() - 60_000
    )
    expect(await emailsTo(TEAM)).toEqual([])
  })

  it('tells the team when only the dimension changed', async () => {
    const expiresAt = new Date(Date.now() + 30 * DAY_MS)
    const { licenseArn } = await insertLicense({
      expiresAt,
      lastVerifiedAt: new Date(Date.now() - 2 * DAY_MS),
    })
    entitlementsByLicense.set(licenseArn, [
      currentEntitlement({ ExpirationDate: expiresAt, Dimension: 'premier' }),
    ])
    deliverOnce([])

    await reconcileAwsMarketplaceLicenses()

    expect(await emailsTo(TEAM)).toEqual([
      expect.objectContaining({ text: expect.stringMatching(/After: active, dimension premier/) }),
    ])
  })

  it('stamps a License Updated event, which the provisioning notice then reports', async () => {
    const { id, licenseArn } = await insertLicense()
    entitlementsByLicense.set(licenseArn, [currentEntitlement()])
    deliverOnce([licenseUpdated(licenseArn)])

    await reconcileAwsMarketplaceLicenses()

    const row = await readLicense(licenseArn)
    expect(row?.licenseEventReceivedAt).toBeInstanceOf(Date)
    expect(row?.id).toBe(id)
  })

  it('tells the team once when the License Updated event reaches a license already taken', async () => {
    const organizationId = await createOrganization([{ userId: await createUser(), role: 'owner' }])
    const linked = await insertLicense({ organizationId })
    const registered = await insertLicense({ linkedByUserId: await createUser() })
    const unowned = await insertLicense()
    for (const { licenseArn } of [linked, registered, unowned]) {
      entitlementsByLicense.set(licenseArn, [currentEntitlement()])
    }
    deliverOnce([
      licenseUpdated(linked.licenseArn),
      licenseUpdated(registered.licenseArn),
      licenseUpdated(unowned.licenseArn),
      licenseUpdated(linked.licenseArn),
    ])

    expect(await reconcileAwsMarketplaceLicenses()).toMatchObject({ applied: 4, retained: 0 })

    const received = (await emailsTo(TEAM)).filter((email) =>
      /License Updated event received/.test(email.subject)
    )
    const announces = ({ id }: { id: string }) =>
      received.filter((email) => email.text.includes(`License ID: ${id}`)).length
    expect(received).toHaveLength(2)
    expect(announces(linked)).toBe(1)
    expect(announces(registered)).toBe(1)
    expect(announces(unowned)).toBe(0)
  })

  it('keeps a Deprovisioned event for redelivery while AWS still reports the license current', async () => {
    const { licenseArn } = await insertLicense()
    entitlementsByLicense.set(licenseArn, [currentEntitlement()])
    const deleted = deliverOnce([
      {
        'detail-type': 'License Deprovisioned - Manufacturer',
        detail: { license: { arn: licenseArn }, product: { code: PRODUCT } },
      },
    ])

    expect(await reconcileAwsMarketplaceLicenses()).toMatchObject({ retained: 1 })
    expect(deleted).toEqual([])
  })

  it('leaves a license event with no ARN for the dead-letter queue', async () => {
    const deleted = deliverOnce([
      { 'detail-type': 'License Updated - Manufacturer', detail: { product: { code: PRODUCT } } },
    ])

    expect(await reconcileAwsMarketplaceLicenses()).toMatchObject({ retained: 1 })
    expect(deleted).toEqual([])
  })

  it('keeps a License Updated event for redelivery while AWS describes nothing for an unknown license', async () => {
    const licenseArn = uniqueArn()
    entitlementsByLicense.set(licenseArn, [])
    const deleted = deliverOnce([licenseUpdated(licenseArn)])

    expect(await reconcileAwsMarketplaceLicenses()).toMatchObject({
      retained: 1,
      skipped: 0,
      applied: 0,
    })
    expect(deleted).toEqual([])
    expect(await readLicense(licenseArn)).toBeUndefined()
  })

  it('skips and deletes a Deprovisioned event for a license it never recorded', async () => {
    const licenseArn = uniqueArn()
    entitlementsByLicense.set(licenseArn, [])
    const deleted = deliverOnce([
      {
        'detail-type': 'License Deprovisioned - Manufacturer',
        detail: { license: { arn: licenseArn }, product: { code: PRODUCT } },
      },
    ])

    expect(await reconcileAwsMarketplaceLicenses()).toMatchObject({ skipped: 1, retained: 0 })
    expect(deleted).toEqual(['r-0'])
    expect(await readLicense(licenseArn)).toBeUndefined()
  })

  it('records a license an event names that nobody registered and tells the team who may own it', async () => {
    const account = uniqueAccount()
    const ownerId = await createUser()
    const organizationId = await createOrganization([{ userId: ownerId, role: 'owner' }])
    await insertLicense({ organizationId, customerAwsAccountId: account })
    const newArn = uniqueArn()
    entitlementsByLicense.set(newArn, [
      currentEntitlement({ CustomerAWSAccountId: undefined, Value: { IntegerValue: 60 } }),
    ])
    deliverOnce([
      {
        ...licenseUpdated(newArn),
        detail: {
          license: { arn: newArn },
          product: { code: PRODUCT },
          acceptor: { accountId: account },
        },
      },
    ])

    await reconcileAwsMarketplaceLicenses()

    expect(await readLicense(newArn)).toMatchObject({
      customerAwsAccountId: account,
      organizationId: null,
      status: 'active',
      quantity: 60,
    })
    expect(await emailsTo(TEAM)).toEqual([
      expect.objectContaining({
        subject: expect.stringMatching(/New license/),
        text: expect.stringContaining(`Marketplace organization (${organizationId})`),
      }),
    ])
  })

  it('stops receiving batches once the run budget cannot fit another', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      queueSend.mockImplementation(async (command: { kind: string }) => {
        if (command.kind !== 'receive') return {}
        vi.setSystemTime(Date.now() + 60_000)
        return {
          Messages: [{ MessageId: generateId(), ReceiptHandle: generateId(), Body: '{not json' }],
        }
      })

      const summary = await reconcileAwsMarketplaceLicenses()

      const receives = queueSend.mock.calls.filter(([command]) => command.kind === 'receive')
      expect(summary?.outOfBudget).toBe(true)
      expect(receives.length).toBeGreaterThan(0)
      expect(receives.length).toBeLessThan(10)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves messages it has not started queued once the run budget cannot fit another', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const licenses = await Promise.all([insertLicense(), insertLicense()])
      for (const { licenseArn } of licenses) {
        entitlementsByLicense.set(licenseArn, [currentEntitlement()])
      }
      const deleted = deliverOnce(
        licenses.map(({ licenseArn }) => ({
          'detail-type': 'License Updated - Manufacturer',
          detail: { license: { arn: licenseArn }, product: { code: PRODUCT } },
        }))
      )
      const receive = queueSend.getMockImplementation()
      queueSend.mockImplementation(async (command: { kind: string }) => {
        const answer = await receive?.(command)
        if (command.kind === 'receive') vi.setSystemTime(Date.now() + 6 * 60_000)
        return answer
      })

      const summary = await reconcileAwsMarketplaceLicenses()

      expect(summary).toMatchObject({ received: 0, outOfBudget: true })
      expect(deleted).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps licenses AWS keeps refusing from starving the rest of the re-verify', async () => {
    const failing = Array.from({ length: 50 }, () => uniqueArn())
    const healthyArn = uniqueArn()
    const longAgo = (days: number) => new Date(Date.now() - days * DAY_MS)
    await db.insert(awsMarketplaceLicense).values([
      ...failing.map((licenseArn) => ({
        id: generateId(),
        licenseArn,
        productCode: PRODUCT,
        customerAwsAccountId: ACCOUNT,
        status: 'active' as const,
        lastVerifiedAt: longAgo(3),
        lastVerificationAttemptAt: longAgo(3),
      })),
      {
        id: generateId(),
        licenseArn: healthyArn,
        productCode: PRODUCT,
        customerAwsAccountId: ACCOUNT,
        status: 'active' as const,
        lastVerifiedAt: longAgo(2),
        lastVerificationAttemptAt: longAgo(2),
      },
    ])
    const rejected = Object.assign(new Error('Invalid license'), {
      name: 'InvalidParameterException',
      $metadata: { httpStatusCode: 400 },
    })
    for (const licenseArn of failing) entitlementsByLicense.set(licenseArn, rejected)
    entitlementsByLicense.set(healthyArn, [currentEntitlement()])
    queueSend.mockResolvedValue({ Messages: [] })

    const first = await reconcileAwsMarketplaceLicenses()
    const second = await reconcileAwsMarketplaceLicenses()

    expect(first).toMatchObject({ reverified: 0, reverifyFailed: 50 })
    expect(second).toMatchObject({ reverified: 1, reverifyFailed: 0 })
    expect((await readLicense(healthyArn))?.lastVerifiedAt.getTime()).toBeGreaterThan(
      Date.now() - 60_000
    )
  })
})

describe('agreement events', () => {
  it('re-verifies the license of an ended agreement, from an event that names no product', async () => {
    const agreementId = uniqueAgreement()
    const { licenseArn } = await insertLicense({ agreementId })
    entitlementsByLicense.set(licenseArn, [])
    const deleted = deliverOnce([
      {
        'detail-type': 'Purchase Agreement Ended - Proposer',
        detail: { agreement: { id: agreementId } },
      },
    ])

    expect(await reconcileAwsMarketplaceLicenses()).toMatchObject({ applied: 1, discarded: 0 })
    expect(deleted).toEqual(['r-0'])
    expect((await readLicense(licenseArn))?.status).toBe('inactive')
    expect(await emailsTo(TEAM)).toEqual([
      expect.objectContaining({ subject: expect.stringMatching(/active → inactive/) }),
    ])
  })

  it('keeps an ended agreement queued while AWS still reports its license current', async () => {
    const agreementId = uniqueAgreement()
    const { licenseArn } = await insertLicense({ agreementId })
    entitlementsByLicense.set(licenseArn, [currentEntitlement()])
    const deleted = deliverOnce([
      {
        'detail-type': 'Purchase Agreement Ended - Proposer',
        detail: { agreement: { id: agreementId } },
      },
    ])

    expect(await reconcileAwsMarketplaceLicenses()).toMatchObject({ retained: 1, applied: 0 })
    expect(deleted).toEqual([])
  })

  it('reads every license of an ended agreement even when one fails, and keeps the message', async () => {
    const agreementId = uniqueAgreement()
    const failing = await insertLicense({ agreementId, lastVerificationAttemptAt: new Date(0) })
    const healthy = await insertLicense({ agreementId })
    entitlementsByLicense.set(failing.licenseArn, throttled())
    entitlementsByLicense.set(healthy.licenseArn, [])
    const deleted = deliverOnce([
      {
        'detail-type': 'Purchase Agreement Ended - Manufacturer',
        detail: { agreement: { id: agreementId } },
      },
    ])

    expect(await reconcileAwsMarketplaceLicenses()).toMatchObject({ retained: 1 })
    expect(deleted).toEqual([])
    expect((await readLicense(failing.licenseArn))?.status).toBe('active')
    expect((await readLicense(healthy.licenseArn))?.status).toBe('inactive')
  })

  it('discards an ended agreement it holds no license for without asking AWS', async () => {
    const deleted = deliverOnce([
      {
        'detail-type': 'Purchase Agreement Ended - Manufacturer',
        detail: { agreement: { id: uniqueAgreement() }, product: { code: 'other-product' } },
      },
    ])

    expect(await reconcileAwsMarketplaceLicenses()).toMatchObject({ applied: 0, discarded: 1 })
    expect(deleted).toEqual(['r-0'])
    expect(entitlementSend).not.toHaveBeenCalled()
    expect(await emailsTo(/./)).toEqual([])
  })

  it('discards a created agreement that replaces nothing it holds', async () => {
    const stored = uniqueAgreement()
    const { licenseArn } = await insertLicense({ agreementId: stored })
    const deleted = deliverOnce([
      agreementCreated(uniqueAgreement()),
      agreementCreated(uniqueAgreement(), uniqueAgreement()),
    ])

    expect(await reconcileAwsMarketplaceLicenses()).toMatchObject({ applied: 0, discarded: 2 })
    expect(deleted.sort()).toEqual(['r-0', 'r-1'])
    expect(await emailsTo(/./)).toEqual([])
    expect((await readLicense(licenseArn))?.renewedAgreementId).toBeNull()
  })

  it('tells the team of an advisory on an agreement it holds, and ignores others', async () => {
    const agreementId = uniqueAgreement()
    await insertLicense({ agreementId })
    const deleted = deliverOnce([
      {
        'detail-type': 'Purchase Agreement Advisory Issued - Manufacturer',
        detail: { agreement: { id: agreementId }, advisory: 'payment' },
      },
      {
        'detail-type': 'Purchase Agreement Advisory Resolved - Manufacturer',
        detail: { agreement: { id: uniqueAgreement() } },
      },
    ])

    expect(await reconcileAwsMarketplaceLicenses()).toMatchObject({ applied: 1, discarded: 1 })
    expect(deleted.sort()).toEqual(['r-0', 'r-1'])
    expect(await emailsTo(TEAM)).toEqual([
      expect.objectContaining({
        subject: expect.stringMatching(/advisory issued/),
        text: expect.stringMatching(/payment/),
      }),
    ])
  })
})

describe('a replaced agreement', () => {
  async function linkedPredecessor() {
    const account = uniqueAccount()
    const ownerId = await createUser()
    const organizationId = await createOrganization([{ userId: ownerId, role: 'owner' }])
    const previousAgreementId = uniqueAgreement()
    const old = await insertLicense({
      organizationId,
      linkedByUserId: ownerId,
      contactEmail: CONTACT.contactEmail,
      companyName: CONTACT.companyName,
      customerAwsAccountId: account,
      agreementId: previousAgreementId,
    })
    return { ...old, account, ownerId, organizationId, previousAgreementId }
  }

  it('hands the owner on when the Created event arrives first, telling the team once', async () => {
    const old = await linkedPredecessor()
    const agreementId = uniqueAgreement()
    const newArn = uniqueArn()
    entitlementsByLicense.set(newArn, [currentEntitlement({ CustomerAWSAccountId: old.account })])
    deliverOnce([
      agreementCreated(agreementId, old.previousAgreementId),
      agreementCreated(agreementId, old.previousAgreementId),
      licenseUpdated(newArn, agreementId),
    ])

    expect(await reconcileAwsMarketplaceLicenses()).toMatchObject({ retained: 0 })

    expect(await readLicense(old.licenseArn)).toMatchObject({ renewedAgreementId: agreementId })
    expect(await readLicense(newArn)).toMatchObject({
      organizationId: old.organizationId,
      linkedByUserId: old.ownerId,
      contactEmail: CONTACT.contactEmail,
      agreementId,
    })
    const notices = await emailsTo(TEAM)
    expect(notices.filter((email) => /Agreement replaced/.test(email.subject))).toHaveLength(1)
  })

  it('hands the owner on when the license event arrives first', async () => {
    const old = await linkedPredecessor()
    const agreementId = uniqueAgreement()
    const newArn = uniqueArn()
    entitlementsByLicense.set(newArn, [currentEntitlement({ CustomerAWSAccountId: old.account })])
    deliverOnce([licenseUpdated(newArn, agreementId)])
    await reconcileAwsMarketplaceLicenses()
    expect((await readLicense(newArn))?.organizationId).toBeNull()

    deliverOnce([agreementCreated(agreementId, old.previousAgreementId)])
    await reconcileAwsMarketplaceLicenses()

    expect(await readLicense(newArn)).toMatchObject({
      organizationId: old.organizationId,
      linkedByUserId: old.ownerId,
    })
    const notices = await emailsTo(TEAM)
    expect(notices.filter((email) => /Agreement replaced/.test(email.subject))).toHaveLength(1)
  })

  it('still tells the team when a license event already moved the row to the new agreement', async () => {
    const old = await linkedPredecessor()
    const agreementId = uniqueAgreement()
    entitlementsByLicense.set(old.licenseArn, [
      currentEntitlement({ CustomerAWSAccountId: old.account }),
    ])
    deliverOnce([
      licenseUpdated(old.licenseArn, agreementId, new Date()),
      agreementCreated(agreementId, old.previousAgreementId),
    ])

    await reconcileAwsMarketplaceLicenses()

    expect((await readLicense(old.licenseArn))?.agreementId).toBe(agreementId)
    const notices = await emailsTo(TEAM)
    expect(notices.filter((email) => /Agreement replaced/.test(email.subject))).toHaveLength(1)
  })

  it('does not let a late A→B overwrite B→C', async () => {
    const old = await linkedPredecessor()
    const middle = uniqueAgreement()
    const latest = uniqueAgreement()
    deliverOnce([
      agreementCreated(middle, old.previousAgreementId),
      agreementCreated(latest, middle),
      agreementCreated(middle, old.previousAgreementId),
    ])

    await reconcileAwsMarketplaceLicenses()

    expect((await readLicense(old.licenseArn))?.renewedAgreementId).toBe(latest)
  })

  it('does not let a redelivered old license event roll the agreement back', async () => {
    const newer = uniqueAgreement()
    const older = uniqueAgreement()
    const { licenseArn } = await insertLicense()
    entitlementsByLicense.set(licenseArn, [currentEntitlement()])
    deliverOnce([
      licenseUpdated(licenseArn, newer, new Date(Date.now() - 1000)),
      licenseUpdated(licenseArn, older, new Date(Date.now() - 60_000)),
    ])

    await reconcileAwsMarketplaceLicenses()

    expect((await readLicense(licenseArn))?.agreementId).toBe(newer)
  })

  it('tells the team not to cancel when a superseded license ends', async () => {
    const old = await linkedPredecessor()
    await db
      .update(awsMarketplaceLicense)
      .set({
        renewedAgreementId: uniqueAgreement(),
        lastVerificationAttemptAt: new Date(Date.now() - 2 * DAY_MS),
      })
      .where(eq(awsMarketplaceLicense.id, old.id))
    entitlementsByLicense.set(old.licenseArn, [])
    deliverOnce([])

    await reconcileAwsMarketplaceLicenses()

    const [notice] = await emailsTo(TEAM)
    expect(notice.text).toMatch(/Do not cancel/)
    expect(notice.text).not.toMatch(CANCEL_CALL)
  })
})

describe('the admin license route', () => {
  function adminRequest(
    body?: Record<string, string>,
    key: string | null = 'admin-key-placeholder'
  ) {
    return new NextRequest(
      'http://localhost:3000/api/v1/admin/dashboard/aws-marketplace-licenses?limit=250&offset=0',
      {
        method: body ? 'POST' : 'GET',
        headers: {
          'content-type': 'application/json',
          ...(key && { 'x-admin-key': key }),
        },
        ...(body && { body: JSON.stringify(body) }),
      }
    )
  }

  it('refuses a caller without the admin key', async () => {
    const { id, licenseArn } = await insertLicense()
    const organizationId = await createOrganization([{ userId: await createUser(), role: 'owner' }])

    const response = await adminLink(adminRequest({ licenseId: id, organizationId }, null), {})

    expect(response.status).toBe(401)
    expect((await readLicense(licenseArn))?.organizationId).toBeNull()
  })

  it('lists a license while unlinked, links it, and refuses to move it', async () => {
    const { id, licenseArn } = await insertLicense()
    const organizationId = await createOrganization([{ userId: await createUser(), role: 'owner' }])
    const otherOrganizationId = await createOrganization([
      { userId: await createUser(), role: 'owner' },
    ])
    const listed = await (await adminList(adminRequest(), {})).json()
    expect(listed).toMatchObject({
      data: expect.arrayContaining([expect.objectContaining({ id })]),
    })

    const linked = await adminLink(adminRequest({ licenseId: id, organizationId }), {})
    const moved = await adminLink(
      adminRequest({ licenseId: id, organizationId: otherOrganizationId }),
      {}
    )

    expect(linked.status).toBe(200)
    expect(moved.status).toBe(409)
    expect((await readLicense(licenseArn))?.organizationId).toBe(organizationId)
    await vi.waitFor(async () => {
      const entries = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.resourceId, id))
      expect(entries).toEqual([{ action: 'aws_marketplace_license.linked' }])
    })
    await db.delete(auditLog).where(eq(auditLog.resourceId, id))
  })
})
