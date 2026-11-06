import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { AwsMarketplaceClaim } from '@/lib/api/contracts/aws-marketplace'
import { awsMarketplaceOperations } from '@/lib/billing/aws-marketplace/application/operations'
import { hashClaimToken } from '@/lib/billing/aws-marketplace/claim'
import { getAwsMarketplaceProductCode } from '@/lib/billing/aws-marketplace/config'
import { verifyLicense } from '@/lib/billing/aws-marketplace/entitlements'
import {
  type AwsMarketplaceLicenseRecord,
  consumeLicenseClaim,
  findLicenseByClaimHash,
  getLinkParties,
  listAdministeredOrganizations,
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
import { env } from '@/lib/core/config/env'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getEmailDomain } from '@/lib/core/utils/urls'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress } from '@/lib/messaging/email/utils'

const logger = createLogger('AwsMarketplaceLicenses')

/** The same answer as an unknown route, so a deployment that does not sell on AWS shows nothing. */
function requireProductCode(): string {
  const productCode = getAwsMarketplaceProductCode()
  if (!productCode) throw new OrchestrationError('not_found', 'Not found')
  return productCode
}

function isClaimOpen(license: AwsMarketplaceLicenseRecord, now: Date): boolean {
  return Boolean(license.claimExpiresAt && license.claimExpiresAt.getTime() > now.getTime())
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
    await recordLicenseVerification({
      licenseArn: claimed.licenseArn,
      productCode,
      summary,
      verifiedAt,
    })
    throw new OrchestrationError(
      'conflict',
      'AWS Marketplace reports no active subscription for this license.'
    )
  }
  return { claimHash, summary, verifiedAt }
}

const TEAM_INSTRUCTIONS = {
  organization:
    'Provision this organization the way Enterprise deals are provisioned. No subscription was changed.',
  account:
    'Registered to an account, no organization yet. Create the Enterprise organization for this buyer and link it. No subscription was changed.',
} as const

/**
 * Tells the team a license is taken, so they provision it the way an Enterprise deal is
 * provisioned. No subscription is created or changed here. A failed send never undoes the
 * committed write; the warning is the fallback trail.
 */
async function notifyTeam(
  license: AwsMarketplaceLicenseRecord,
  organizationId: string | null,
  userId: string
): Promise<void> {
  const parties = await getLinkParties(organizationId, userId)
  const notice = {
    licenseId: license.id,
    organizationId,
    dimension: license.dimension,
    quantity: license.quantity,
    expiresAt: license.expiresAt?.toISOString() ?? null,
  }
  const text = `AWS Marketplace license ${organizationId ? 'linked' : 'registered to an account'}
Taken: ${new Date().toISOString()}
Organization: ${organizationId ? `${parties.organizationName ?? 'Unknown'} (${organizationId})` : 'None yet'}
Buyer: ${parties.userName ?? 'Unknown'} <${parties.userEmail ?? 'unknown'}> (${userId})
License: ${license.licenseArn}
AWS account: ${license.customerAwsAccountId ?? 'Not provided'}
Customer identifier: ${license.customerIdentifier}
Dimension: ${license.dimension ?? 'Not provided'}
Quantity: ${license.quantity ?? 'Not provided'}
Expires: ${notice.expiresAt ?? 'No expiry'}

${TEAM_INSTRUCTIONS[organizationId ? 'organization' : 'account']}
`
  const subject = organizationId
    ? (parties.organizationName ?? organizationId)
    : `${parties.userEmail ?? userId} (no organization)`
  try {
    const result = await sendEmail({
      to: [`enterprise@${env.EMAIL_DOMAIN || getEmailDomain()}`],
      subject: `[AWS MARKETPLACE] ${subject}`,
      text,
      from: getFromEmailAddress(),
      ...(parties.userEmail && { replyTo: parties.userEmail }),
      emailType: 'transactional',
    })
    if (result.success) {
      logger.info('Notified the team of an AWS Marketplace license', notice)
      return
    }
    logger.warn('Could not notify the team of an AWS Marketplace license', {
      ...notice,
      message: result.message,
    })
  } catch (error) {
    logger.warn('Could not notify the team of an AWS Marketplace license', {
      ...notice,
      message: getErrorMessage(error, 'Unknown error'),
    })
  }
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
        summary,
        verifiedAt,
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
      await notifyTeam(result.license, input.organizationId, context.userId)
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
        summary,
        verifiedAt,
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
      await notifyTeam(license, null, principal.userId)
    }
    return { licenseId: license.id }
  },
}
