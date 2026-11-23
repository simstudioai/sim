import { AuditAction, type AuditActionType, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import type { AwsMarketplaceClaim } from '@/lib/api/contracts/aws-marketplace'
import { awsMarketplaceOperations } from '@/lib/billing/aws-marketplace/application/operations'
import { hashClaimToken } from '@/lib/billing/aws-marketplace/claim'
import {
  findAwsMarketplaceProduct,
  isAwsMarketplaceEnabled,
} from '@/lib/billing/aws-marketplace/config'
import { verifyLicense } from '@/lib/billing/aws-marketplace/entitlements'
import {
  type AwsMarketplaceLicenseRecord,
  type BuyerContact,
  consumeLicenseClaim,
  findLicenseByClaimHash,
  isNewerRead,
  listAccountLicenses,
  listAdministeredOrganizations,
  listOrganizationLicenses,
  lockLicense,
  paysForSelfServePlan,
  recordLicenseVerification,
  saveLicenseContact,
} from '@/lib/billing/aws-marketplace/repository'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import { assertOperationPrincipal, type OperationUseCase } from '@/lib/core/application/operation'
import { requireOrganizationSubjectMembership } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'

/** The same answer as an unknown route, so a deployment that does not sell on AWS shows nothing. */
function requireMarketplaceEnabled(): void {
  if (!isAwsMarketplaceEnabled()) throw new OrchestrationError('not_found', 'Not found')
}

/** The listing a license was sold under; one this deployment no longer sells reads as unknown. */
function requireLicenseProduct(license: AwsMarketplaceLicenseRecord) {
  const product = findAwsMarketplaceProduct(license.productCode)
  if (!product) throw new OrchestrationError('not_found', 'Not found')
  return product
}

function isClaimOpen(license: AwsMarketplaceLicenseRecord, now: Date): boolean {
  return Boolean(license.claimExpiresAt && license.claimExpiresAt.getTime() > now.getTime())
}

const NO_ACTIVE_SUBSCRIPTION = 'AWS Marketplace reports no active subscription for this license.'
const SUBSCRIPTION_UNCONFIRMED =
  'AWS is still confirming your subscription. Try again in a few minutes.'

/**
 * Under the row lock, after the claim is rechecked: a newer read that still says pending wins over
 * this request's. A newer read that says inactive already cleared the claim.
 */
function requireNotOverruled(locked: AwsMarketplaceLicenseRecord, verifiedAt: Date): void {
  if (locked.status === 'pending' && !isNewerRead(locked, verifiedAt)) {
    throw new OrchestrationError('conflict', SUBSCRIPTION_UNCONFIRMED)
  }
}

const CLAIM_NOT_FOUND =
  'This AWS Marketplace setup link is no longer valid. Open your subscription in AWS Marketplace and choose Set up your account again.'

/** Refuses unless this browser's claim still names this license and has not expired. */
function requireOpenClaim(
  license: AwsMarketplaceLicenseRecord | null,
  licenseId: string,
  claimHash: string | null
): AwsMarketplaceLicenseRecord {
  if (!license || !claimHash || license.id !== licenseId || license.claimTokenHash !== claimHash) {
    throw new OrchestrationError('forbidden', CLAIM_NOT_FOUND)
  }
  if (!isClaimOpen(license, new Date())) {
    throw new OrchestrationError(
      'forbidden',
      'This AWS Marketplace setup link has expired. Open your subscription in AWS Marketplace and choose Set up your account again.'
    )
  }
  return license
}

/** A license linked to one organization is never moved, and never taken without one. */
export function requireLinkableTo(
  license: AwsMarketplaceLicenseRecord,
  organizationId: string | null
): void {
  if (license.organizationId && license.organizationId !== organizationId) {
    throw new OrchestrationError(
      'conflict',
      'This AWS Marketplace subscription is already linked to another organization.'
    )
  }
}

/**
 * AWS bills a linked organization for the listing, so one already paying Stripe for a plan would
 * pay twice. Its subscription is cancelled first, by its owner or by support.
 */
export async function requireNotBilledThroughStripe(
  tx: DbTransaction,
  organizationId: string
): Promise<void> {
  if (await paysForSelfServePlan(tx, organizationId)) {
    throw new OrchestrationError(
      'conflict',
      'This organization already pays for a Sim plan. Cancel that subscription, or contact support, before linking an AWS Marketplace subscription to it.'
    )
  }
}

/** Enough for a buyer to recognize their account, and no more for someone holding their claim. */
function maskAwsAccount(accountId: string): string {
  return `••••${accountId.slice(-4)}`
}

function claimedLicenseView(license: AwsMarketplaceLicenseRecord) {
  return {
    id: license.id,
    status: license.status,
    dimension: license.dimension,
    quantity: license.quantity,
    expiresAt: license.expiresAt?.toISOString() ?? null,
    awsAccount: maskAwsAccount(license.customerAwsAccountId),
    contactEmail: license.contactEmail,
    companyName: license.companyName,
  }
}

/**
 * The pending claim this browser holds, and where the signed-in person could link it. Who a linked
 * license belongs to is said only to someone who administers that organization.
 */
export const readAwsMarketplaceClaim: OperationUseCase<
  typeof awsMarketplaceOperations.readClaim,
  { claimToken: string | null },
  AwsMarketplaceClaim
> = {
  operation: awsMarketplaceOperations.readClaim,
  async execute({ principal, input }) {
    assertOperationPrincipal(principal, awsMarketplaceOperations.readClaim)
    requireMarketplaceEnabled()
    if (!input.claimToken) return { status: 'missing' }
    const license = await findLicenseByClaimHash(hashClaimToken(input.claimToken))
    if (!license || !isClaimOpen(license, new Date())) return { status: 'missing' }
    if (license.status === 'pending') {
      return { status: 'pending', license: claimedLicenseView(license) }
    }
    const organizations = await listAdministeredOrganizations(principal.userId)
    if (license.organizationId) {
      return {
        status: 'linked',
        organizationId: organizations.some((org) => org.id === license.organizationId)
          ? license.organizationId
          : null,
      }
    }
    return { status: 'ready', license: claimedLicenseView(license), organizations }
  },
}

interface ClaimInput {
  licenseId: string
  /** The raw claim token from this browser's httpOnly cookie, or null when it holds none. */
  claimToken: string | null
}

type TakeInput = ClaimInput & BuyerContact

interface LinkLicenseInput extends TakeInput {
  organizationId: string
}

interface LinkedLicense {
  license: AwsMarketplaceLicenseRecord
  /** False when the license already belonged here; nothing new to audit or announce. */
  newlyLinked: boolean
}

/** The license this browser's claim names, refused unless the claim is still open. */
async function findOpenClaim(input: ClaimInput) {
  const claimHash = input.claimToken ? hashClaimToken(input.claimToken) : null
  const claimed = requireOpenClaim(
    claimHash ? await findLicenseByClaimHash(claimHash) : null,
    input.licenseId,
    claimHash
  )
  return { claimHash, claimed }
}

/** Locks the claimed license and checks the claim again, so two tabs racing it take it once. */
async function lockOpenClaim(tx: DbTransaction, input: ClaimInput, claimHash: string | null) {
  return requireOpenClaim(await lockLicense(tx, input.licenseId), input.licenseId, claimHash)
}

/**
 * Checks this browser's claim, then asks the Entitlement Service again: a license is taken only
 * while AWS says it is current. An answer that is not is recorded before the refusal. The caller
 * rechecks the claim under the row lock, so two tabs racing one claim take it at most once.
 */
async function verifyClaimedLicense(input: ClaimInput, organizationId: string | null) {
  requireMarketplaceEnabled()
  const { claimHash, claimed } = await findOpenClaim(input)
  requireLinkableTo(claimed, organizationId)

  const verifiedAt = new Date()
  const summary = await verifyLicense(requireLicenseProduct(claimed), claimed.licenseArn)
  const verification = { summary, verifiedAt }
  if (!summary.active) {
    const outcome = await recordLicenseVerification({
      licenseArn: claimed.licenseArn,
      productCode: claimed.productCode,
      verification,
    })
    throw new OrchestrationError(
      'conflict',
      outcome.kind === 'updated' && outcome.license.status === 'pending'
        ? SUBSCRIPTION_UNCONFIRMED
        : NO_ACTIVE_SUBSCRIPTION
    )
  }
  return { claimHash, verification }
}

/** The audit entry for a license changing hands; `metadata` adds to its terms. */
export function licenseAuditEntry(
  license: AwsMarketplaceLicenseRecord,
  action: AuditActionType,
  description: string,
  metadata: Record<string, unknown> = {}
) {
  return {
    action,
    resourceType: AuditResourceType.AWS_MARKETPLACE_LICENSE,
    resourceId: license.id,
    resourceName: license.dimension ?? 'AWS Marketplace license',
    description,
    metadata: {
      dimension: license.dimension,
      quantity: license.quantity,
      expiresAt: license.expiresAt?.toISOString() ?? null,
      ...metadata,
    },
  }
}

/**
 * Links the license this browser's claim names to an organization the caller administers. A
 * license belongs to at most one organization; one registered to an account and no organization
 * yet may still be linked.
 */
export const linkAwsMarketplaceLicense = defineAuthorizedOrganizationUseCase({
  operation: awsMarketplaceOperations.linkLicense,
  async execute({
    input,
    context,
  }: OrganizationUseCaseContext<LinkLicenseInput>): Promise<LinkedLicense> {
    const { claimHash, verification } = await verifyClaimedLicense(input, input.organizationId)
    return db.transaction(async (tx) => {
      const locked = await lockOpenClaim(tx, input, claimHash)
      requireLinkableTo(locked, input.organizationId)
      requireNotOverruled(locked, verification.verifiedAt)
      // Holds the admin's membership until commit, so a concurrent demotion waits for the link.
      await requireOrganizationSubjectMembership(
        context.userId,
        input.organizationId,
        'admin',
        'none',
        undefined,
        { executor: tx, forShare: true }
      )
      const newlyLinked = locked.organizationId !== input.organizationId
      if (newlyLinked) await requireNotBilledThroughStripe(tx, input.organizationId)
      const license = await consumeLicenseClaim(tx, locked, {
        link: newlyLinked ? { organizationId: input.organizationId, userId: context.userId } : null,
        contact: input,
        verification,
      })
      return { license, newlyLinked }
    })
  },
  projectAudit: ({ result }) =>
    result.newlyLinked
      ? licenseAuditEntry(
          result.license,
          AuditAction.AWS_MARKETPLACE_LICENSE_LINKED,
          'Linked an AWS Marketplace subscription to the organization'
        )
      : [],
})

/**
 * Registers the license this browser's claim names to the signed-in account, with no
 * organization: a new buyer who administers none still completes setup, and the team creates
 * the Enterprise organization and links it. A license already linked to an organization is
 * refused; registering it here never moves it.
 */
export const registerAwsMarketplaceLicenseToAccount: OperationUseCase<
  typeof awsMarketplaceOperations.registerToAccount,
  TakeInput,
  { licenseId: string }
> = {
  operation: awsMarketplaceOperations.registerToAccount,
  async execute({ principal, input, request }) {
    assertOperationPrincipal(principal, awsMarketplaceOperations.registerToAccount)
    const { claimHash, verification } = await verifyClaimedLicense(input, null)
    const { license, newlyRegistered } = await db.transaction(async (tx) => {
      const locked = await lockOpenClaim(tx, input, claimHash)
      requireLinkableTo(locked, null)
      requireNotOverruled(locked, verification.verifiedAt)
      const newlyRegistered = locked.linkedByUserId !== principal.userId
      const consumed = await consumeLicenseClaim(tx, locked, {
        link: newlyRegistered ? { organizationId: null, userId: principal.userId } : null,
        contact: input,
        verification,
      })
      return { license: consumed, newlyRegistered }
    })
    if (newlyRegistered) {
      recordProjectedUseCaseAuditEntries(
        awsMarketplaceOperations.registerToAccount,
        null,
        principal,
        request,
        [
          licenseAuditEntry(
            license,
            AuditAction.AWS_MARKETPLACE_LICENSE_REGISTERED,
            'Registered an AWS Marketplace subscription to an account'
          ),
        ]
      )
    }
    return { licenseId: license.id }
  },
}

/**
 * While AWS is still confirming a license, its buyer leaves contact details here and asks AWS
 * again. The claim stays open: linking waits for a read that says the license is current.
 */
export const saveAwsMarketplaceClaimContact: OperationUseCase<
  typeof awsMarketplaceOperations.saveClaimContact,
  TakeInput,
  { status: 'pending' | 'active' | 'inactive' }
> = {
  operation: awsMarketplaceOperations.saveClaimContact,
  async execute({ principal, input }) {
    assertOperationPrincipal(principal, awsMarketplaceOperations.saveClaimContact)
    requireMarketplaceEnabled()
    const { claimHash, claimed } = await findOpenClaim(input)
    const verifiedAt = new Date()
    const summary = await verifyLicense(requireLicenseProduct(claimed), claimed.licenseArn)
    return db.transaction(async (tx) => {
      const locked = await lockOpenClaim(tx, input, claimHash)
      const license = await saveLicenseContact(tx, locked, {
        contact: input,
        verification: { summary, verifiedAt },
      })
      return { status: license.status }
    })
  },
}

function toLicenseStatusList(rows: Awaited<ReturnType<typeof listOrganizationLicenses>>) {
  return rows.map((row) => ({
    ...row,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastVerifiedAt: row.lastVerifiedAt.toISOString(),
  }))
}

/**
 * The Marketplace licenses linked to an organization, so its members can see their subscription
 * in Sim. Empty where Sim does not sell on AWS, so the billing page shows nothing there.
 */
export const listOrganizationAwsMarketplaceLicenses = defineAuthorizedOrganizationUseCase({
  operation: awsMarketplaceOperations.listOrganizationLicenses,
  async execute({ context }: OrganizationUseCaseContext<{ organizationId: string }>) {
    if (!isAwsMarketplaceEnabled()) return []
    return toLicenseStatusList(await listOrganizationLicenses(context.organizationId))
  },
})

/** The licenses registered to the caller's account with no organization yet, for their billing page. */
export const listAccountAwsMarketplaceLicenses: OperationUseCase<
  typeof awsMarketplaceOperations.listAccountLicenses,
  Record<string, never>,
  ReturnType<typeof toLicenseStatusList>
> = {
  operation: awsMarketplaceOperations.listAccountLicenses,
  async execute({ principal }) {
    assertOperationPrincipal(principal, awsMarketplaceOperations.listAccountLicenses)
    if (!isAwsMarketplaceEnabled()) return []
    return toLicenseStatusList(await listAccountLicenses(principal.userId))
  },
}
