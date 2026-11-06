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

function requireLinkableTo(license: AwsMarketplaceLicenseRecord, organizationId: string): void {
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

interface LinkLicenseInput {
  organizationId: string
  licenseId: string
  /** The raw claim token from this browser's httpOnly cookie, or null when it holds none. */
  claimToken: string | null
}

interface LinkedLicense {
  license: AwsMarketplaceLicenseRecord
  /** False when the license was already linked to this organization; nothing new to announce. */
  newlyLinked: boolean
}

/**
 * Tells the team a license now belongs to an organization, so they provision it the way an
 * Enterprise deal is provisioned. No subscription is created or changed here. A failed send never
 * undoes the committed link; the warning is the fallback trail.
 */
async function notifyTeamOfLinkedLicense(
  license: AwsMarketplaceLicenseRecord,
  organizationId: string,
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
  const text = `AWS Marketplace license linked
Linked: ${new Date().toISOString()}
Organization: ${parties.organizationName ?? 'Unknown'} (${organizationId})
Linked by: ${parties.userName ?? 'Unknown'} <${parties.userEmail ?? 'unknown'}>
License: ${license.licenseArn}
AWS account: ${license.customerAwsAccountId ?? 'Not provided'}
Customer identifier: ${license.customerIdentifier}
Dimension: ${license.dimension ?? 'Not provided'}
Quantity: ${license.quantity ?? 'Not provided'}
Expires: ${notice.expiresAt ?? 'No expiry'}

Provision this organization the way Enterprise deals are provisioned. No subscription was changed.
`
  try {
    const result = await sendEmail({
      to: [`enterprise@${env.EMAIL_DOMAIN || getEmailDomain()}`],
      subject: `[AWS MARKETPLACE] ${parties.organizationName ?? organizationId}`,
      text,
      from: getFromEmailAddress(),
      ...(parties.userEmail && { replyTo: parties.userEmail }),
      emailType: 'transactional',
    })
    if (result.success) {
      logger.info('Notified the team of a linked AWS Marketplace license', notice)
      return
    }
    logger.warn('Could not notify the team of a linked AWS Marketplace license', {
      ...notice,
      message: result.message,
    })
  } catch (error) {
    logger.warn('Could not notify the team of a linked AWS Marketplace license', {
      ...notice,
      message: getErrorMessage(error, 'Unknown error'),
    })
  }
}

/**
 * Links the license this browser's claim names to an organization the caller administers. The
 * claim is checked before and again under the row lock, so two tabs racing one claim link it at
 * most once, and the Entitlement Service is asked again: a license links only while AWS says it
 * is current. A license belongs to at most one organization.
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
    const productCode = requireProductCode()
    const claimHash = input.claimToken ? hashClaimToken(input.claimToken) : null
    const claimed = requireOpenClaim(
      claimHash ? await findLicenseByClaimHash(claimHash) : null,
      input.licenseId,
      claimHash
    )
    requireLinkableTo(claimed, input.organizationId)

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
          metadata: {
            dimension: result.license.dimension,
            quantity: result.license.quantity,
            expiresAt: result.license.expiresAt?.toISOString() ?? null,
          },
        }
      : [],
  afterSuccess: async ({ result, input, context }) => {
    if (result.newlyLinked) {
      await notifyTeamOfLinkedLicense(result.license, input.organizationId, context.userId)
    }
  },
})
