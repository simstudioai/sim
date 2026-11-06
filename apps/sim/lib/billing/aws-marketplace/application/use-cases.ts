import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import type { AwsMarketplaceClaim } from '@/lib/api/contracts/aws-marketplace'
import { awsMarketplaceOperations } from '@/lib/billing/aws-marketplace/application/operations'
import { hashClaimToken } from '@/lib/billing/aws-marketplace/claim'
import { getAwsMarketplaceProductCode } from '@/lib/billing/aws-marketplace/config'
import { type EntitlementSummary, verifyLicense } from '@/lib/billing/aws-marketplace/entitlements'
import {
  notifyBuyerOfTakenLicense,
  notifyTeamOfTakenLicense,
  notifyTeamOfVerification,
} from '@/lib/billing/aws-marketplace/notifications'
import {
  type AwsMarketplaceLicenseRecord,
  consumeLicenseClaim,
  findLicenseByClaimHash,
  listAdministeredOrganizations,
  listOrganizationLicenses,
  lockLicense,
  recordLicenseVerification,
} from '@/lib/billing/aws-marketplace/repository'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import { assertOperationPrincipal, type OperationUseCase } from '@/lib/core/application/operation'
import { requireOrganizationSubjectMembership } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** The same answer as an unknown route, so a deployment that does not sell on AWS shows nothing. */
function requireProductCode(): string {
  const productCode = getAwsMarketplaceProductCode()
  if (!productCode) throw new OrchestrationError('not_found', 'Not found')
  return productCode
}

function isClaimOpen(license: AwsMarketplaceLicenseRecord, now: Date): boolean {
  return Boolean(license.claimExpiresAt && license.claimExpiresAt.getTime() > now.getTime())
}

const NO_ACTIVE_SUBSCRIPTION = 'AWS Marketplace reports no active subscription for this license.'

/**
 * Under the row lock: a newer verification than this request's wins. If it says the license
 * lapsed, the take is refused; otherwise it stands and this older read is not written.
 */
function newerVerificationGate(
  locked: AwsMarketplaceLicenseRecord,
  verifiedAt: Date,
  summary: EntitlementSummary
) {
  if (locked.lastVerifiedAt.getTime() <= verifiedAt.getTime()) return { summary, verifiedAt }
  if (locked.status !== 'active') throw new OrchestrationError('conflict', NO_ACTIVE_SUBSCRIPTION)
  return null
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
function requireLinkableTo(
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

/** The pending claim this browser holds, and where the signed-in person could link it. */
export const readAwsMarketplaceClaim: OperationUseCase<
  typeof awsMarketplaceOperations.readClaim,
  { claimToken: string | null },
  AwsMarketplaceClaim
> = {
  operation: awsMarketplaceOperations.readClaim,
  async execute({ principal, input }) {
    assertOperationPrincipal(principal, awsMarketplaceOperations.readClaim)
    requireProductCode()
    if (!input.claimToken) return { status: 'missing' }
    const license = await findLicenseByClaimHash(hashClaimToken(input.claimToken))
    if (!license) return { status: 'missing' }
    if (!isClaimOpen(license, new Date())) return { status: 'expired' }
    return {
      status: 'ready',
      license: {
        id: license.id,
        status: license.status,
        dimension: license.dimension,
        quantity: license.quantity,
        expiresAt: license.expiresAt?.toISOString() ?? null,
        organizationId: license.organizationId,
      },
      organizations: await listAdministeredOrganizations(principal.userId),
    }
  },
}

interface ClaimInput {
  licenseId: string
  /** The raw claim token from this browser's httpOnly cookie, or null when it holds none. */
  claimToken: string | null
  /** Whom to contact about provisioning; AWS asks the registration page to collect it. */
  contactEmail: string
  companyName: string | null
}

interface LinkLicenseInput extends ClaimInput {
  organizationId: string
}

interface LinkedLicense {
  license: AwsMarketplaceLicenseRecord
  /** False when the license already belonged here; nothing new to audit or announce. */
  newlyLinked: boolean
}

/**
 * Checks this browser's claim, then asks the Entitlement Service again: a license is taken only
 * while AWS says it is current. A lapsed answer is recorded before the refusal. The caller
 * rechecks the claim under the row lock, so two tabs racing one claim take it at most once.
 */
async function verifyClaimedLicense(input: ClaimInput, organizationId: string | null) {
  const productCode = requireProductCode()
  const claimHash = input.claimToken ? hashClaimToken(input.claimToken) : null
  const claimed = requireOpenClaim(
    claimHash ? await findLicenseByClaimHash(claimHash) : null,
    input.licenseId,
    claimHash
  )
  requireLinkableTo(claimed, organizationId)

  const verifiedAt = new Date()
  const summary = await verifyLicense(productCode, claimed.licenseArn)
  if (!summary.active) {
    await notifyTeamOfVerification(
      await recordLicenseVerification({
        licenseArn: claimed.licenseArn,
        productCode,
        summary,
        verifiedAt,
      })
    )
    throw new OrchestrationError('conflict', NO_ACTIVE_SUBSCRIPTION)
  }
  return { claimHash, summary, verifiedAt }
}

function licenseAuditMetadata(license: AwsMarketplaceLicenseRecord) {
  return {
    dimension: license.dimension,
    quantity: license.quantity,
    expiresAt: license.expiresAt?.toISOString() ?? null,
  }
}

/**
 * Links the license this browser's claim names to an organization the caller administers. A
 * license belongs to at most one organization; one registered to an account and no organization
 * yet may still be linked.
 */
export const linkAwsMarketplaceLicense = defineAuthorizedOrganizationUseCase({
  operation: awsMarketplaceOperations.linkLicense,
  authorizeResource: () => {
    requireProductCode()
  },
  async execute({
    input,
    context,
  }: OrganizationUseCaseContext<LinkLicenseInput>): Promise<LinkedLicense> {
    const { claimHash, summary, verifiedAt } = await verifyClaimedLicense(
      input,
      input.organizationId
    )
    return db.transaction(async (tx) => {
      const locked = requireOpenClaim(
        await lockLicense(tx, input.licenseId),
        input.licenseId,
        claimHash
      )
      requireLinkableTo(locked, input.organizationId)
      /** Holds the admin's membership until commit, so a concurrent demotion waits for the link. */
      await requireOrganizationSubjectMembership(
        context.userId,
        input.organizationId,
        'admin',
        'none',
        undefined,
        { executor: tx, forShare: true }
      )
      const newlyLinked = locked.organizationId !== input.organizationId
      const license = await consumeLicenseClaim(tx, {
        licenseId: input.licenseId,
        link: newlyLinked ? { organizationId: input.organizationId, userId: context.userId } : null,
        contact: { email: input.contactEmail, companyName: input.companyName },
        verification: newerVerificationGate(locked, verifiedAt, summary),
      })
      return { license, newlyLinked }
    })
  },
  projectAudit: ({ result }) =>
    result.newlyLinked
      ? {
          workspaceId: null,
          action: AuditAction.AWS_MARKETPLACE_LICENSE_LINKED,
          resourceType: AuditResourceType.AWS_MARKETPLACE_LICENSE,
          resourceId: result.license.id,
          resourceName: result.license.dimension ?? 'AWS Marketplace license',
          description: 'Linked an AWS Marketplace subscription to the organization',
          metadata: licenseAuditMetadata(result.license),
        }
      : [],
  afterSuccess: async ({ result, input, context }) => {
    if (result.newlyLinked) {
      await notifyTeamOfTakenLicense(result.license, input.organizationId, context.userId)
      await notifyBuyerOfTakenLicense(result.license)
    }
  },
})

/**
 * Registers the license this browser's claim names to the signed-in account, with no
 * organization: a new buyer who administers none still completes setup, and the team creates
 * the Enterprise organization and links it. A license already linked to an organization is
 * refused; registering it here never moves it.
 */
export const registerAwsMarketplaceLicenseToAccount: OperationUseCase<
  typeof awsMarketplaceOperations.registerToAccount,
  ClaimInput,
  { licenseId: string }
> = {
  operation: awsMarketplaceOperations.registerToAccount,
  async execute({ principal, input, request }) {
    assertOperationPrincipal(principal, awsMarketplaceOperations.registerToAccount)
    const { claimHash, summary, verifiedAt } = await verifyClaimedLicense(input, null)
    const { license, newlyRegistered } = await db.transaction(async (tx) => {
      const locked = requireOpenClaim(
        await lockLicense(tx, input.licenseId),
        input.licenseId,
        claimHash
      )
      requireLinkableTo(locked, null)
      const newlyRegistered = locked.linkedByUserId !== principal.userId
      const consumed = await consumeLicenseClaim(tx, {
        licenseId: input.licenseId,
        link: newlyRegistered ? { organizationId: null, userId: principal.userId } : null,
        contact: { email: input.contactEmail, companyName: input.companyName },
        verification: newerVerificationGate(locked, verifiedAt, summary),
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
          {
            action: AuditAction.AWS_MARKETPLACE_LICENSE_REGISTERED,
            resourceType: AuditResourceType.AWS_MARKETPLACE_LICENSE,
            resourceId: license.id,
            resourceName: license.dimension ?? 'AWS Marketplace license',
            description: 'Registered an AWS Marketplace subscription to an account',
            metadata: licenseAuditMetadata(license),
          },
        ]
      )
      await notifyTeamOfTakenLicense(license, null, principal.userId)
      await notifyBuyerOfTakenLicense(license)
    }
    return { licenseId: license.id }
  },
}

/**
 * The Marketplace licenses linked to an organization, so its members can see their subscription
 * in Sim. Empty where Sim does not sell on AWS, so the billing page shows nothing there.
 */
export const listOrganizationAwsMarketplaceLicenses = defineAuthorizedOrganizationUseCase({
  operation: awsMarketplaceOperations.listOrganizationLicenses,
  async execute({ context }: OrganizationUseCaseContext<{ organizationId: string }>) {
    if (!getAwsMarketplaceProductCode()) return []
    return listOrganizationLicenses(context.organizationId)
  },
})
