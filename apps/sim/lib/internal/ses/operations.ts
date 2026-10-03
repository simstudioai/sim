import type { SESv2Client, SuppressionListReason } from '@aws-sdk/client-sesv2'
import type { AwsSesCreateConfigurationSetBody } from '@/lib/api/contracts/tools/aws/ses-create-configuration-set'
import type { AwsSesCreateEmailIdentityBody } from '@/lib/api/contracts/tools/aws/ses-create-email-identity'
import type { AwsSesCreateTemplateBody } from '@/lib/api/contracts/tools/aws/ses-create-template'
import type { AwsSesDeleteEmailIdentityBody } from '@/lib/api/contracts/tools/aws/ses-delete-email-identity'
import type { AwsSesDeleteSuppressedDestinationBody } from '@/lib/api/contracts/tools/aws/ses-delete-suppressed-destination'
import type { AwsSesDeleteTemplateBody } from '@/lib/api/contracts/tools/aws/ses-delete-template'
import type { AwsSesGetAccountBody } from '@/lib/api/contracts/tools/aws/ses-get-account'
import type { AwsSesGetEmailIdentityBody } from '@/lib/api/contracts/tools/aws/ses-get-email-identity'
import type { AwsSesGetSuppressedDestinationBody } from '@/lib/api/contracts/tools/aws/ses-get-suppressed-destination'
import type { AwsSesGetTemplateBody } from '@/lib/api/contracts/tools/aws/ses-get-template'
import type { AwsSesListIdentitiesBody } from '@/lib/api/contracts/tools/aws/ses-list-identities'
import type { AwsSesListSuppressedDestinationsBody } from '@/lib/api/contracts/tools/aws/ses-list-suppressed-destinations'
import type { AwsSesListTemplatesBody } from '@/lib/api/contracts/tools/aws/ses-list-templates'
import type { AwsSesPutSuppressedDestinationBody } from '@/lib/api/contracts/tools/aws/ses-put-suppressed-destination'
import type { AwsSesSendBulkEmailBody } from '@/lib/api/contracts/tools/aws/ses-send-bulk-email'
import type { AwsSesSendCustomVerificationEmailBody } from '@/lib/api/contracts/tools/aws/ses-send-custom-verification-email'
import type { AwsSesSendEmailBody } from '@/lib/api/contracts/tools/aws/ses-send-email'
import type { AwsSesSendTemplatedEmailBody } from '@/lib/api/contracts/tools/aws/ses-send-templated-email'
import type { AwsSesUpdateTemplateBody } from '@/lib/api/contracts/tools/aws/ses-update-template'
import {
  createConfigurationSet,
  createEmailIdentity,
  createSESClient,
  createTemplate,
  deleteEmailIdentity,
  deleteSuppressedDestination,
  deleteTemplate,
  getAccount,
  getEmailIdentity,
  getSuppressedDestination,
  getTemplate,
  listIdentities,
  listSuppressedDestinations,
  listTemplates,
  parseBulkEmailDestinations,
  putSuppressedDestination,
  sendBulkEmail,
  sendCustomVerificationEmail,
  sendEmail,
  sendTemplatedEmail,
  updateTemplate,
} from '@/lib/internal/ses/client'
import type { SESConnectionConfig } from '@/tools/ses/types'

const VALID_SUPPRESSION_REASONS: SuppressionListReason[] = ['BOUNCE', 'COMPLAINT']

export class SesOperationInputError extends Error {}

async function withSesClient<T>(
  input: SESConnectionConfig,
  execute: (client: SESv2Client) => Promise<T>
): Promise<T> {
  const client = createSESClient(input)
  try {
    return await execute(client)
  } finally {
    client.destroy()
  }
}

function splitEmailAddresses(value?: string | null): string[] | null {
  if (!value) return null
  return value
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
}

export function executeSesSendEmail(input: AwsSesSendEmailBody, signal?: AbortSignal) {
  return withSesClient(input, (client) =>
    sendEmail(
      client,
      {
        fromAddress: input.fromAddress,
        toAddresses: splitEmailAddresses(input.toAddresses) ?? [],
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
        ccAddresses: splitEmailAddresses(input.ccAddresses),
        bccAddresses: splitEmailAddresses(input.bccAddresses),
        replyToAddresses: splitEmailAddresses(input.replyToAddresses),
        configurationSetName: input.configurationSetName,
      },
      signal
    )
  )
}

export function executeSesSendTemplatedEmail(
  input: AwsSesSendTemplatedEmailBody,
  signal?: AbortSignal
) {
  return withSesClient(input, (client) =>
    sendTemplatedEmail(
      client,
      {
        fromAddress: input.fromAddress,
        toAddresses: splitEmailAddresses(input.toAddresses) ?? [],
        templateName: input.templateName,
        templateData: input.templateData,
        ccAddresses: splitEmailAddresses(input.ccAddresses),
        bccAddresses: splitEmailAddresses(input.bccAddresses),
        configurationSetName: input.configurationSetName,
      },
      signal
    )
  )
}

export function executeSesSendBulkEmail(input: AwsSesSendBulkEmailBody, signal?: AbortSignal) {
  let destinations: ReturnType<typeof parseBulkEmailDestinations>
  try {
    destinations = parseBulkEmailDestinations(input.destinations)
  } catch {
    throw new SesOperationInputError(
      'destinations must be a valid JSON array of destination objects'
    )
  }

  return withSesClient(input, (client) =>
    sendBulkEmail(
      client,
      {
        fromAddress: input.fromAddress,
        templateName: input.templateName,
        destinations,
        defaultTemplateData: input.defaultTemplateData,
        configurationSetName: input.configurationSetName,
      },
      signal
    )
  )
}

export function executeSesListIdentities(input: AwsSesListIdentitiesBody, signal?: AbortSignal) {
  return withSesClient(input, (client) =>
    listIdentities(client, { pageSize: input.pageSize, nextToken: input.nextToken }, signal)
  )
}

export function executeSesGetAccount(input: AwsSesGetAccountBody, signal?: AbortSignal) {
  return withSesClient(input, (client) => getAccount(client, signal))
}

export function executeSesCreateTemplate(input: AwsSesCreateTemplateBody, signal?: AbortSignal) {
  return withSesClient(input, (client) =>
    createTemplate(
      client,
      {
        templateName: input.templateName,
        subjectPart: input.subjectPart,
        textPart: input.textPart,
        htmlPart: input.htmlPart,
      },
      signal
    )
  )
}

export function executeSesGetTemplate(input: AwsSesGetTemplateBody, signal?: AbortSignal) {
  return withSesClient(input, (client) => getTemplate(client, input.templateName, signal))
}

export function executeSesListTemplates(input: AwsSesListTemplatesBody, signal?: AbortSignal) {
  return withSesClient(input, (client) =>
    listTemplates(client, { pageSize: input.pageSize, nextToken: input.nextToken }, signal)
  )
}

export function executeSesDeleteTemplate(input: AwsSesDeleteTemplateBody, signal?: AbortSignal) {
  return withSesClient(input, (client) => deleteTemplate(client, input.templateName, signal))
}

export function executeSesUpdateTemplate(input: AwsSesUpdateTemplateBody, signal?: AbortSignal) {
  return withSesClient(input, (client) =>
    updateTemplate(
      client,
      {
        templateName: input.templateName,
        subjectPart: input.subjectPart,
        textPart: input.textPart,
        htmlPart: input.htmlPart,
      },
      signal
    )
  )
}

export function executeSesPutSuppressedDestination(
  input: AwsSesPutSuppressedDestinationBody,
  signal?: AbortSignal
) {
  return withSesClient(input, (client) =>
    putSuppressedDestination(
      client,
      { emailAddress: input.emailAddress, reason: input.reason },
      signal
    )
  )
}

export function executeSesDeleteSuppressedDestination(
  input: AwsSesDeleteSuppressedDestinationBody,
  signal?: AbortSignal
) {
  return withSesClient(input, (client) =>
    deleteSuppressedDestination(client, input.emailAddress, signal)
  )
}

export function executeSesGetSuppressedDestination(
  input: AwsSesGetSuppressedDestinationBody,
  signal?: AbortSignal
) {
  return withSesClient(input, (client) =>
    getSuppressedDestination(client, input.emailAddress, signal)
  )
}

export function executeSesListSuppressedDestinations(
  input: AwsSesListSuppressedDestinationsBody,
  signal?: AbortSignal
) {
  let reasons: SuppressionListReason[] | null = null
  if (input.reasons) {
    const candidates = input.reasons
      .split(',')
      .map((reason) => reason.trim())
      .filter(Boolean)
    const invalid = candidates.filter(
      (reason) => !VALID_SUPPRESSION_REASONS.includes(reason as SuppressionListReason)
    )
    if (invalid.length > 0) {
      throw new SesOperationInputError(
        `Invalid suppression reason(s): ${invalid.join(', ')}. Must be one of: ${VALID_SUPPRESSION_REASONS.join(', ')}`
      )
    }
    reasons = candidates as SuppressionListReason[]
  }

  return withSesClient(input, (client) =>
    listSuppressedDestinations(
      client,
      {
        reasons,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        pageSize: input.pageSize,
        nextToken: input.nextToken,
      },
      signal
    )
  )
}

export function executeSesCreateEmailIdentity(
  input: AwsSesCreateEmailIdentityBody,
  signal?: AbortSignal
) {
  return withSesClient(input, (client) =>
    createEmailIdentity(
      client,
      {
        emailIdentity: input.emailIdentity,
        dkimSigningAttributes: input.dkimSigningAttributes,
        tags: input.tags,
        configurationSetName: input.configurationSetName,
      },
      signal
    )
  )
}

export function executeSesDeleteEmailIdentity(
  input: AwsSesDeleteEmailIdentityBody,
  signal?: AbortSignal
) {
  return withSesClient(input, (client) => deleteEmailIdentity(client, input.emailIdentity, signal))
}

export function executeSesGetEmailIdentity(
  input: AwsSesGetEmailIdentityBody,
  signal?: AbortSignal
) {
  return withSesClient(input, (client) => getEmailIdentity(client, input.emailIdentity, signal))
}

export function executeSesCreateConfigurationSet(
  input: AwsSesCreateConfigurationSetBody,
  signal?: AbortSignal
) {
  const suppressedReasons = input.suppressedReasons
    ? (input.suppressedReasons
        .split(',')
        .map((reason) => reason.trim())
        .filter(Boolean) as SuppressionListReason[])
    : null

  return withSesClient(input, (client) =>
    createConfigurationSet(
      client,
      {
        configurationSetName: input.configurationSetName,
        customRedirectDomain: input.customRedirectDomain,
        httpsPolicy: input.httpsPolicy,
        tlsPolicy: input.tlsPolicy,
        sendingPoolName: input.sendingPoolName,
        reputationMetricsEnabled: input.reputationMetricsEnabled,
        sendingEnabled: input.sendingEnabled,
        suppressedReasons,
        tags: input.tags,
      },
      signal
    )
  )
}

export function executeSesSendCustomVerificationEmail(
  input: AwsSesSendCustomVerificationEmailBody,
  signal?: AbortSignal
) {
  return withSesClient(input, (client) =>
    sendCustomVerificationEmail(
      client,
      {
        emailAddress: input.emailAddress,
        templateName: input.templateName,
        configurationSetName: input.configurationSetName,
      },
      signal
    )
  )
}
