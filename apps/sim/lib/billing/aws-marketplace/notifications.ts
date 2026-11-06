import { createLogger } from '@sim/logger'
import {
  AWS_MARKETPLACE_BUYER_NOTICE_EVENT,
  AWS_MARKETPLACE_TEAM_NOTICE_EVENT,
  type AwsMarketplaceBuyerNotice,
  type AwsMarketplaceNoticeTerms,
  type AwsMarketplaceTeamNotice,
} from '@/lib/billing/aws-marketplace/notice-events'
import { AWS_MARKETPLACE_SETUP_TURNAROUND } from '@/lib/billing/aws-marketplace/onboarding'
import {
  type AwsMarketplaceLicenseRecord,
  getLicensesByIds,
  getLinkParties,
  listOrganizationsLinkedToAccount,
} from '@/lib/billing/aws-marketplace/repository'
import { env } from '@/lib/core/config/env'
import type { OutboxHandler, OutboxHandlerRegistry } from '@/lib/core/outbox/service'
import { getEmailDomain } from '@/lib/core/utils/urls'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress } from '@/lib/messaging/email/utils'
import { getBrandConfig } from '@/ee/whitelabeling'

const logger = createLogger('AwsMarketplaceNotifications')

/**
 * Enterprise provisioning otherwise sends Stripe invoices, and AWS requires a listed product to be
 * billed entirely through its dimensions, so paused collection is the one safe way to provision.
 */
const PROVISION =
  'Provision through the admin API (POST /api/v1/admin/dashboard/enterprise-provisioning, or enterprise-owner-claims for a new owner) with pausePaymentCollection: true, sized from the dimension, quantity, and expiry above. Never send a Stripe invoice for a Marketplace customer: AWS bills them.'
const LINK =
  'Then link the license with POST /api/v1/admin/dashboard/aws-marketplace-licenses (licenseId, organizationId).'
const CANCEL =
  'Cancel the Enterprise subscription with POST /api/v1/admin/dashboard/organizations/<id>/cancellation (operationId: a new UUID, timing: immediate), unless a replacement notice for this account follows. The organization goes dormant and is not deleted.'
const NO_ORGANIZATION_TO_CANCEL =
  'No organization holds this license. If you provisioned one for this buyer, cancel it there.'
const UNCONFIRMED =
  'Unconfirmed: AWS has returned no entitlement for this license yet. Do not provision it until its status is active.'

interface RenderedEmail {
  to: string
  subject: string
  text: string
  replyTo?: string | null
}

function teamInbox(): string {
  return `enterprise@${env.EMAIL_DOMAIN || getEmailDomain()}`
}

function formatTerms(terms: AwsMarketplaceNoticeTerms): string {
  return `${terms.status}, dimension ${terms.dimension ?? 'not provided'}, quantity ${
    terms.quantity ?? 'not provided'
  }, expires ${terms.expiresAt ?? 'never'}`
}

async function describeLicense(license: AwsMarketplaceLicenseRecord): Promise<string> {
  const { organizationName } = await getLinkParties(license.organizationId, null)
  return `Organization: ${
    license.organizationId ? `${organizationName ?? 'Unknown'} (${license.organizationId})` : 'None'
  }
License ID: ${license.id}
License: ${license.licenseArn}
AWS account: ${license.customerAwsAccountId}
Agreement: ${license.agreementId ?? 'Not provided'}
Status: ${license.status}
Dimension: ${license.dimension ?? 'Not provided'}
Quantity: ${license.quantity ?? 'Not provided'}
Expires: ${license.expiresAt?.toISOString() ?? 'Never'}
Contact email: ${license.contactEmail ?? 'Not provided'}
Company: ${license.companyName ?? 'Not provided'}
License Updated event: ${
    license.licenseEventReceivedAt
      ? `received ${license.licenseEventReceivedAt.toISOString()}`
      : 'not received yet; AWS says not to activate a subscription until it arrives'
  }`
}

/**
 * What is left for the team to do about one license AWS has just changed. It reads the license as
 * it stands now, because an outbox retry can deliver a notice after a newer change.
 */
function nextStepForTerms(license: AwsMarketplaceLicenseRecord): string {
  if (license.status === 'inactive' && license.renewedAgreementId) {
    return `Agreement ${license.renewedAgreementId} replaced this license's agreement. Do not cancel on this notice: AWS grants the replacement its own license, so check that one.`
  }
  if (license.status === 'inactive') {
    return license.organizationId ? CANCEL : NO_ORGANIZATION_TO_CANCEL
  }
  if (license.status === 'active' && !license.organizationId) return `${PROVISION} ${LINK}`
  return 'Update the Enterprise provisioning to match. Never send a Stripe invoice for a Marketplace customer: AWS bills them.'
}

/** Each notice's subject, opening, and next step; the license details between them are shared. */
async function teamNoticeCopy(
  notice: AwsMarketplaceTeamNotice,
  license: AwsMarketplaceLicenseRecord
): Promise<{ subject: string; opening: string; next: string; replyTo?: string | null }> {
  const account = `AWS account ${license.customerAwsAccountId}`
  switch (notice.kind) {
    case 'new-license': {
      const linked = await listOrganizationsLinkedToAccount({
        customerAwsAccountId: license.customerAwsAccountId,
        productCode: license.productCode,
        excludingLicenseArn: license.licenseArn,
      })
      const others = linked.length
        ? linked.map((org) => `${org.name} (${org.id})`).join(', ')
        : 'None'
      return {
        subject: `New license for ${account}`,
        opening: `${
          notice.source === 'registration'
            ? 'A buyer started AWS Marketplace setup. They may not finish it.'
            : 'An AWS Marketplace license appeared that no buyer has registered.'
        }${license.status === 'pending' ? `\n${UNCONFIRMED}` : ''}
Organizations linked to other licenses of this account: ${others}`,
        next: license.organizationId
          ? 'It carries on the organization of the license it replaces. Keep that organization provisioned to the terms above.'
          : license.status === 'active'
            ? `${PROVISION} ${LINK}`
            : 'Do not provision this license. A notice follows if AWS reports it active.',
      }
    }
    case 'taken': {
      const { userName, userEmail } = await getLinkParties(null, notice.userId)
      return {
        subject: license.organizationId
          ? `Linked to an organization: ${account}`
          : `${license.contactEmail ?? userEmail ?? notice.userId} (no organization)`,
        opening: `AWS Marketplace license ${
          license.organizationId ? 'linked' : 'registered to an account, no organization yet'
        }. Taken by ${userName ?? 'Unknown'} <${userEmail ?? 'unknown'}> (${notice.userId}). The buyer was told to wait for you to contact them.`,
        next: license.organizationId
          ? PROVISION
          : `Create the Enterprise organization for this buyer. ${PROVISION} ${LINK}`,
        replyTo: license.contactEmail ?? userEmail,
      }
    }
    case 'contact': {
      const confirming = license.status === 'pending'
      return {
        subject: `Buyer contact: ${account}`,
        opening: confirming
          ? `A buyer left contact details while AWS confirms their subscription.\n${UNCONFIRMED}`
          : 'A buyer changed their contact details.',
        next: confirming
          ? 'Nothing to provision on this notice; a separate one follows when AWS confirms it.'
          : 'Nothing to provision on this notice. Use these contact details from now on.',
        replyTo: license.contactEmail,
      }
    }
    case 'license-event-received':
      return {
        subject: `License Updated event received: ${account}`,
        opening:
          'AWS sent the License Updated event for a license already taken. AWS says not to activate a subscription until it arrives.',
        next:
          license.status === 'active'
            ? 'Provisioning that was waiting for this event can go ahead, following the earlier notice.'
            : 'Do not provision it until its status is active.',
      }
    case 'terms-changed':
      return {
        subject: `License ${notice.before.status} → ${notice.after.status}: ${account}`,
        opening: `AWS Marketplace changed what this license grants.
Before: ${formatTerms(notice.before)}
After: ${formatTerms(notice.after)}`,
        next: nextStepForTerms(license),
      }
    case 'renewed':
      return {
        subject: `Agreement replaced: ${account}`,
        opening: `An AWS Marketplace agreement was replaced.
Previous agreement: ${notice.previousAgreementId}
New agreement: ${notice.agreementId}`,
        next: 'AWS grants a new license with every new agreement. It inherits the organization below when it arrives, and a notice follows. Do not cancel because the previous license ends.',
      }
    case 'advisory':
      return {
        subject: `Agreement advisory ${notice.state}: ${account}`,
        opening: `AWS Marketplace ${notice.state} an advisory on agreement ${notice.agreementId}.
Event detail: ${notice.detail}`,
        next: 'Review the agreement in the AWS Marketplace Management Portal.',
      }
  }
}

async function renderTeamNotice(notice: AwsMarketplaceTeamNotice): Promise<RenderedEmail | null> {
  const licenses = await getLicensesByIds(
    'licenseIds' in notice ? notice.licenseIds : [notice.licenseId]
  )
  const license = licenses[0]
  if (!license) return null
  const copy = await teamNoticeCopy(notice, license)
  const described = await Promise.all(licenses.map(describeLicense))
  return {
    to: teamInbox(),
    subject: `[AWS MARKETPLACE] ${copy.subject}`,
    replyTo: copy.replyTo,
    text: `${copy.opening}

${described.join('\n\n')}

${copy.next}
`,
  }
}

/** AWS's manual-setup guidance, in its own order: being set up, wait, turnaround, contact. */
async function renderBuyerNotice(notice: AwsMarketplaceBuyerNotice): Promise<RenderedEmail | null> {
  const [license] = await getLicensesByIds([notice.licenseId])
  if (!license?.contactEmail) return null
  const brand = getBrandConfig()
  return {
    to: license.contactEmail,
    subject: `Your ${brand.name} account is being set up`,
    replyTo: brand.supportEmail,
    text: `Thanks for subscribing to ${brand.name} through AWS Marketplace.

Your account is being set up. Please wait for us to contact you. We expect to finish ${AWS_MARKETPLACE_SETUP_TURNAROUND}.

Questions? Contact ${brand.supportEmail}.
`,
  }
}

/**
 * Sends one rendered notice. A failure throws, so the outbox retries it with backoff. Delivery is
 * at least once: the checkpoint narrows the window for a repeat but a crash right after the send
 * can still repeat it, which a person reading these emails can absorb.
 */
function noticeHandler<T extends object>(
  render: (notice: T) => Promise<RenderedEmail | null>
): OutboxHandler<unknown> {
  return async (rawPayload, context) => {
    const payload = rawPayload as T & { sentAt?: string }
    if (payload.sentAt) return
    const email = await render(payload)
    if (!email) {
      logger.warn('Skipping an AWS Marketplace notice with nothing left to say', {
        eventId: context.eventId,
      })
      return
    }
    const result = await sendEmail({
      to: [email.to],
      subject: email.subject,
      text: email.text,
      from: getFromEmailAddress(),
      ...(email.replyTo && { replyTo: email.replyTo }),
      emailType: 'transactional',
    })
    if (!result.success) throw new Error(result.message || 'Failed to send the notice')
    await context.checkpointPayload({ sentAt: new Date().toISOString() })
  }
}

export const awsMarketplaceOutboxHandlers = {
  [AWS_MARKETPLACE_TEAM_NOTICE_EVENT]: noticeHandler(renderTeamNotice),
  [AWS_MARKETPLACE_BUYER_NOTICE_EVENT]: noticeHandler(renderBuyerNotice),
} as const satisfies OutboxHandlerRegistry
