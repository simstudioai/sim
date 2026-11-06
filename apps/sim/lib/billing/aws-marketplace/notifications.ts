import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { AWS_MARKETPLACE_SETUP_TURNAROUND } from '@/lib/billing/aws-marketplace/onboarding'
import {
  type AwsMarketplaceLicenseRecord,
  getLinkParties,
  type LicenseTerms,
  type LicenseVerificationOutcome,
  listOrganizationsLinkedToAccount,
} from '@/lib/billing/aws-marketplace/repository'
import { env } from '@/lib/core/config/env'
import { getEmailDomain } from '@/lib/core/utils/urls'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress } from '@/lib/messaging/email/utils'
import { getBrandConfig } from '@/ee/whitelabeling'

const logger = createLogger('AwsMarketplaceNotifications')

function teamInbox(): string {
  return `enterprise@${env.EMAIL_DOMAIN || getEmailDomain()}`
}

function formatTerms(terms: LicenseTerms): string {
  return `${terms.status}, quantity ${terms.quantity ?? 'not provided'}, expires ${
    terms.expiresAt?.toISOString() ?? 'never'
  }`
}

function licenseLines(license: AwsMarketplaceLicenseRecord): string {
  return `License: ${license.licenseArn}
AWS account: ${license.customerAwsAccountId}
Agreement: ${license.agreementId ?? 'Not provided'}
Dimension: ${license.dimension ?? 'Not provided'}
Terms: ${formatTerms(license)}`
}

/** Provisioning is manual, so a failed send is logged and never undoes the write it reports. */
async function send(
  notice: string,
  licenseId: string,
  email: { to: string; subject: string; text: string; replyTo?: string | null }
): Promise<void> {
  try {
    const result = await sendEmail({
      to: [email.to],
      subject: email.subject,
      text: email.text,
      from: getFromEmailAddress(),
      ...(email.replyTo && { replyTo: email.replyTo }),
      emailType: 'transactional',
    })
    if (result.success) {
      logger.info('Sent an AWS Marketplace notice', { notice, licenseId })
      return
    }
    logger.warn('Could not send an AWS Marketplace notice', {
      notice,
      licenseId,
      message: result.message,
    })
  } catch (error) {
    logger.warn('Could not send an AWS Marketplace notice', {
      notice,
      licenseId,
      message: getErrorMessage(error, 'Unknown error'),
    })
  }
}

/**
 * Every notice runs after its write committed, with the claim already spent, so nothing in it
 * (the lookups included) may fail the request; the warning is the fallback trail.
 */
async function bestEffort(
  notice: string,
  licenseId: string | null,
  notify: () => Promise<void>
): Promise<void> {
  try {
    await notify()
  } catch (error) {
    logger.warn('Could not prepare an AWS Marketplace notice', {
      notice,
      licenseId,
      message: getErrorMessage(error, 'Unknown error'),
    })
  }
}

/**
 * Tells the team a buyer took a license, for an organization or for their account alone, so
 * they provision it the way an Enterprise deal is provisioned. No subscription is changed here.
 */
export function notifyTeamOfTakenLicense(
  license: AwsMarketplaceLicenseRecord,
  organizationId: string | null,
  userId: string
): Promise<void> {
  return bestEffort('team notice of a taken AWS Marketplace license', license.id, () =>
    sendTakenLicenseNotice(license, organizationId, userId)
  )
}

async function sendTakenLicenseNotice(
  license: AwsMarketplaceLicenseRecord,
  organizationId: string | null,
  userId: string
): Promise<void> {
  const parties = await getLinkParties(organizationId, userId)
  const organization = organizationId
    ? `${parties.organizationName ?? 'Unknown'} (${organizationId})`
    : 'None yet'
  const instructions = organizationId
    ? 'Provision this organization the way Enterprise deals are provisioned. No subscription was changed.'
    : 'Registered to an account, no organization yet. Create the Enterprise organization for this buyer and link it. No subscription was changed.'
  await send('team notice of a taken AWS Marketplace license', license.id, {
    to: teamInbox(),
    subject: `[AWS MARKETPLACE] ${
      organizationId
        ? (parties.organizationName ?? organizationId)
        : `${license.contactEmail ?? parties.userEmail ?? userId} (no organization)`
    }`,
    replyTo: license.contactEmail ?? parties.userEmail,
    text: `AWS Marketplace license ${organizationId ? 'linked' : 'registered to an account'}
Organization: ${organization}
Taken by: ${parties.userName ?? 'Unknown'} <${parties.userEmail ?? 'unknown'}> (${userId})
Contact email: ${license.contactEmail ?? 'Not provided'}
Company: ${license.companyName ?? 'Not provided'}
${licenseLines(license)}

${instructions}
`,
  })
}

/** Confirms the registration to the buyer and says what happens next. */
export function notifyBuyerOfTakenLicense(license: AwsMarketplaceLicenseRecord): Promise<void> {
  return bestEffort('buyer confirmation of an AWS Marketplace license', license.id, () =>
    sendBuyerConfirmation(license)
  )
}

async function sendBuyerConfirmation(license: AwsMarketplaceLicenseRecord): Promise<void> {
  if (!license.contactEmail) return
  const brand = getBrandConfig()
  await send('buyer confirmation of an AWS Marketplace license', license.id, {
    to: license.contactEmail,
    subject: `Your ${brand.name} AWS Marketplace subscription is registered`,
    replyTo: brand.supportEmail,
    text: `Your ${brand.name} subscription from AWS Marketplace is registered.

Next steps: our team will set up your Enterprise workspace ${AWS_MARKETPLACE_SETUP_TURNAROUND} and email you when it is ready.

Questions? Contact ${brand.supportEmail}.
`,
  })
}

/**
 * Tells the team when AWS changed what a license grants, or described a license nobody has
 * registered, so a lapsed buyer does not keep Enterprise and a renewal is not missed. An
 * unchanged re-verify sends nothing. A new license is never linked automatically.
 */
export function notifyTeamOfVerification(outcome: LicenseVerificationOutcome): Promise<void> {
  if (outcome.kind === 'skipped' || (outcome.kind === 'updated' && !outcome.changed)) {
    return Promise.resolve()
  }
  return bestEffort('team notice of an AWS Marketplace license change', outcome.license.id, () =>
    sendVerificationNotice(outcome)
  )
}

async function sendVerificationNotice(
  outcome: Exclude<LicenseVerificationOutcome, { kind: 'skipped' }>
): Promise<void> {
  const { license } = outcome
  if (outcome.kind === 'created') {
    const linked = await listOrganizationsLinkedToAccount({
      customerAwsAccountId: license.customerAwsAccountId,
      productCode: license.productCode,
      excludingLicenseArn: license.licenseArn,
    })
    await send('team notice of a new AWS Marketplace license', license.id, {
      to: teamInbox(),
      subject: `[AWS MARKETPLACE] New license for AWS account ${license.customerAwsAccountId}`,
      text: `A new AWS Marketplace license appeared that no buyer has registered.
${licenseLines(license)}
Organizations linked to other licenses of this account: ${
        linked.length ? linked.map((org) => `${org.name} (${org.id})`).join(', ') : 'None'
      }

It is not linked to any organization. Link it if it renews an existing customer.
`,
    })
    return
  }
  const parties = license.organizationId
    ? await getLinkParties(license.organizationId, license.linkedByUserId)
    : null
  await send('team notice of a changed AWS Marketplace license', license.id, {
    to: teamInbox(),
    subject: `[AWS MARKETPLACE] License ${outcome.before.status} → ${license.status}: ${
      parties?.organizationName ?? `AWS account ${license.customerAwsAccountId}`
    }`,
    text: `AWS Marketplace changed what this license grants.
Organization: ${
      license.organizationId
        ? `${parties?.organizationName ?? 'Unknown'} (${license.organizationId})`
        : 'None'
    }
${licenseLines(license)}
Before: ${formatTerms(outcome.before)}
After: ${formatTerms(license)}

Update the organization's Enterprise provisioning to match.
`,
  })
}

/**
 * Tells the team an agreement renewed, naming the organizations its licenses belong to. The
 * renewal may issue a new license ARN (AWS does not say), so nothing is linked automatically.
 */
export function notifyTeamOfAgreementRenewal(
  licenses: AwsMarketplaceLicenseRecord[],
  renewal: { previousAgreementId: string; agreementId: string }
): Promise<void> {
  return bestEffort('team notice of a renewed AWS Marketplace agreement', null, () =>
    sendRenewalNotice(licenses, renewal)
  )
}

async function sendRenewalNotice(
  licenses: AwsMarketplaceLicenseRecord[],
  renewal: { previousAgreementId: string; agreementId: string }
): Promise<void> {
  const described = await Promise.all(
    licenses.map(async (license) => {
      const { organizationName } = await getLinkParties(license.organizationId, null)
      const organization = license.organizationId
        ? `${organizationName ?? 'Unknown'} (${license.organizationId})`
        : 'None'
      return { license, organization, organizationName }
    })
  )
  const first = described[0]
  if (!first) return
  await send('team notice of a renewed AWS Marketplace agreement', first.license.id, {
    to: teamInbox(),
    subject: `[AWS MARKETPLACE] Agreement renewed: ${
      first.organizationName ?? `AWS account ${first.license.customerAwsAccountId}`
    }`,
    text: `An AWS Marketplace agreement renewed.
Previous agreement: ${renewal.previousAgreementId}
New agreement: ${renewal.agreementId}

${described
  .map(({ license, organization }) => `Organization: ${organization}\n${licenseLines(license)}`)
  .join('\n\n')}

The renewal may issue a new license. If one appears, link it to the same organization. Nothing was linked automatically.
`,
  })
}
