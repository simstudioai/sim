import type { SESv2Client, SuppressionListReason } from '@aws-sdk/client-sesv2'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
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
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
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
  type SesEmailAttachment,
  sendBulkEmail,
  sendCustomVerificationEmail,
  sendEmail,
  sendTemplatedEmail,
  updateTemplate,
} from '@/lib/internal/ses/client'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file'
import { downloadServableFilesWithinBudget } from '@/lib/uploads/utils/file.server'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { SESConnectionConfig } from '@/tools/ses/types'

const logger = createLogger('SesOperations')

const VALID_SUPPRESSION_REASONS: SuppressionListReason[] = ['BOUNCE', 'COMPLAINT']

/**
 * SES v2 caps a message, attachments included, at 40 MB after base64 encoding,
 * which grows bytes by a third; 28 MiB of raw attachment bytes stays under it.
 */
const SES_ATTACHMENT_MAX_BYTES = 28 * 1024 * 1024

export class SesOperationInputError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

/** Trusted caller scope a send needs to read the workspace files it attaches. */
export interface SesSendContext {
  requestId: string
  userId?: string
}

function attachmentSizeError(observedBytes: number) {
  const sizeMB = (observedBytes / (1024 * 1024)).toFixed(2)
  return new SesOperationInputError(
    `Total attachment size (${sizeMB}MB) exceeds the 28MB SES attachment limit`
  )
}

async function resolveAttachments(
  files: RawFileInput[] | null | undefined,
  context: SesSendContext | undefined,
  signal?: AbortSignal
): Promise<SesEmailAttachment[] | null> {
  if (!files?.length) return null
  const requestId = context?.requestId ?? 'ses'
  const userFiles = processFilesToUserFiles(files, requestId, logger)
  if (userFiles.length === 0) return null

  const declaredSize = userFiles.reduce((total, file) => total + file.size, 0)
  if (declaredSize > SES_ATTACHMENT_MAX_BYTES) throw attachmentSizeError(declaredSize)
  const userId = context?.userId
  if (!userId) throw new SesOperationInputError('Authentication required', 401)
  for (const file of userFiles) {
    signal?.throwIfAborted()
    const denied = await assertToolFileAccess(file.key, userId, requestId, logger)
    if (denied) throw new SesOperationInputError('File not found', denied.status)
  }

  let resolved: Awaited<ReturnType<typeof downloadServableFilesWithinBudget>>
  try {
    resolved = await downloadServableFilesWithinBudget(userFiles, requestId, logger, {
      totalMaxBytes: SES_ATTACHMENT_MAX_BYTES,
      label: 'Total attachment size',
      signal,
    })
  } catch (error) {
    signal?.throwIfAborted()
    if (isDocNotReadyError(error)) throw new SesOperationInputError(docNotReadyMessage(), 409)
    if (isPayloadSizeLimitError(error)) {
      throw attachmentSizeError(error.observedBytes ?? declaredSize)
    }
    throw new SesOperationInputError(
      `Failed to download attachment: ${getErrorMessage(error, 'Unknown error')}`,
      500
    )
  }

  return userFiles.map((file, index) => {
    const resolvedFile = resolved[index]
    if (!resolvedFile) {
      throw new SesOperationInputError('Failed to download attachment: Missing file data', 500)
    }
    return {
      fileName: file.name,
      contentType: resolvedFile.contentType || file.type || 'application/octet-stream',
      content: resolvedFile.buffer,
    }
  })
}

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

export async function executeSesSendEmail(
  input: AwsSesSendEmailBody,
  signal?: AbortSignal,
  context?: SesSendContext
) {
  const attachments = await resolveAttachments(input.attachments, context, signal)
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
        fromName: input.fromName,
        emailTags: input.emailTags,
        attachments,
      },
      signal
    )
  )
}

export async function executeSesSendTemplatedEmail(
  input: AwsSesSendTemplatedEmailBody,
  signal?: AbortSignal,
  context?: SesSendContext
) {
  const attachments = await resolveAttachments(input.attachments, context, signal)
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
        replyToAddresses: splitEmailAddresses(input.replyToAddresses),
        configurationSetName: input.configurationSetName,
        fromName: input.fromName,
        emailTags: input.emailTags,
        attachments,
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
        replyToAddresses: splitEmailAddresses(input.replyToAddresses),
        fromName: input.fromName,
        emailTags: input.emailTags,
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
