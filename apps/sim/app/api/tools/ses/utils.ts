import {
  CreateConfigurationSetCommand,
  CreateEmailIdentityCommand,
  CreateEmailTemplateCommand,
  DeleteEmailIdentityCommand,
  DeleteEmailTemplateCommand,
  DeleteSuppressedDestinationCommand,
  GetAccountCommand,
  GetEmailIdentityCommand,
  GetEmailTemplateCommand,
  GetSuppressedDestinationCommand,
  ListEmailIdentitiesCommand,
  ListEmailTemplatesCommand,
  ListSuppressedDestinationsCommand,
  PutSuppressedDestinationCommand,
  SESv2Client,
  SendBulkEmailCommand,
  SendCustomVerificationEmailCommand,
  SendEmailCommand,
  type SuppressionListReason,
  type TlsPolicy,
  UpdateEmailTemplateCommand,
} from '@aws-sdk/client-sesv2'
import { z } from 'zod'
import type { SESConnectionConfig } from '@/tools/ses/types'

const SesBulkEmailDestinationSchema = z.object({
  toAddresses: z.array(z.string().email()),
  templateData: z.string().optional(),
})

type SesBulkEmailDestination = z.infer<typeof SesBulkEmailDestinationSchema>

export function createSESClient(config: SESConnectionConfig): SESv2Client {
  return new SESv2Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

export async function sendEmail(
  client: SESv2Client,
  params: {
    fromAddress: string
    toAddresses: string[]
    subject: string
    bodyText?: string | null
    bodyHtml?: string | null
    ccAddresses?: string[] | null
    bccAddresses?: string[] | null
    replyToAddresses?: string[] | null
    configurationSetName?: string | null
  }
) {
  const command = new SendEmailCommand({
    FromEmailAddress: params.fromAddress,
    Destination: {
      ToAddresses: params.toAddresses,
      ...(params.ccAddresses?.length ? { CcAddresses: params.ccAddresses } : {}),
      ...(params.bccAddresses?.length ? { BccAddresses: params.bccAddresses } : {}),
    },
    Content: {
      Simple: {
        Subject: { Data: params.subject },
        Body: {
          ...(params.bodyText ? { Text: { Data: params.bodyText } } : {}),
          ...(params.bodyHtml ? { Html: { Data: params.bodyHtml } } : {}),
        },
      },
    },
    ...(params.replyToAddresses?.length ? { ReplyToAddresses: params.replyToAddresses } : {}),
    ...(params.configurationSetName ? { ConfigurationSetName: params.configurationSetName } : {}),
  })

  const response = await client.send(command)

  return {
    messageId: response.MessageId ?? '',
  }
}

export async function sendTemplatedEmail(
  client: SESv2Client,
  params: {
    fromAddress: string
    toAddresses: string[]
    templateName: string
    templateData: string
    ccAddresses?: string[] | null
    bccAddresses?: string[] | null
    configurationSetName?: string | null
  }
) {
  const command = new SendEmailCommand({
    FromEmailAddress: params.fromAddress,
    Destination: {
      ToAddresses: params.toAddresses,
      ...(params.ccAddresses?.length ? { CcAddresses: params.ccAddresses } : {}),
      ...(params.bccAddresses?.length ? { BccAddresses: params.bccAddresses } : {}),
    },
    Content: {
      Template: {
        TemplateName: params.templateName,
        TemplateData: params.templateData,
      },
    },
    ...(params.configurationSetName ? { ConfigurationSetName: params.configurationSetName } : {}),
  })

  const response = await client.send(command)

  return {
    messageId: response.MessageId ?? '',
  }
}

export function parseBulkEmailDestinations(destinationsJson: string): SesBulkEmailDestination[] {
  const destinations = JSON.parse(destinationsJson)
  return z.array(SesBulkEmailDestinationSchema).parse(destinations)
}

export async function sendBulkEmail(
  client: SESv2Client,
  params: {
    fromAddress: string
    templateName: string
    destinations: SesBulkEmailDestination[]
    defaultTemplateData?: string | null
    configurationSetName?: string | null
  }
) {
  const command = new SendBulkEmailCommand({
    FromEmailAddress: params.fromAddress,
    DefaultContent: {
      Template: {
        TemplateName: params.templateName,
        ...(params.defaultTemplateData ? { TemplateData: params.defaultTemplateData } : {}),
      },
    },
    BulkEmailEntries: params.destinations.map((dest) => ({
      Destination: { ToAddresses: dest.toAddresses },
      ...(dest.templateData
        ? {
            ReplacementEmailContent: {
              ReplacementTemplate: {
                ReplacementTemplateData: dest.templateData,
              },
            },
          }
        : {}),
    })),
    ...(params.configurationSetName ? { ConfigurationSetName: params.configurationSetName } : {}),
  })

  const response = await client.send(command)

  const results = (response.BulkEmailEntryResults ?? []).map((r) => ({
    messageId: r.MessageId ?? null,
    status: r.Status ?? 'UNKNOWN',
    error: r.Error ?? null,
  }))

  const successCount = results.filter((r) => r.status === 'SUCCESS').length
  const failureCount = results.length - successCount

  return { results, successCount, failureCount }
}

export async function listIdentities(
  client: SESv2Client,
  params: {
    pageSize?: number | null
    nextToken?: string | null
  }
) {
  const command = new ListEmailIdentitiesCommand({
    ...(params.pageSize != null ? { PageSize: params.pageSize } : {}),
    ...(params.nextToken ? { NextToken: params.nextToken } : {}),
  })

  const response = await client.send(command)

  const identities = (response.EmailIdentities ?? []).map((identity) => ({
    identityName: identity.IdentityName ?? '',
    identityType: identity.IdentityType ?? '',
    sendingEnabled: identity.SendingEnabled ?? false,
    verificationStatus: identity.VerificationStatus ?? '',
  }))

  return {
    identities,
    nextToken: response.NextToken ?? null,
    count: identities.length,
  }
}

export async function getAccount(client: SESv2Client) {
  const command = new GetAccountCommand({})
  const response = await client.send(command)

  return {
    sendingEnabled: response.SendingEnabled ?? false,
    max24HourSend: response.SendQuota?.Max24HourSend ?? 0,
    maxSendRate: response.SendQuota?.MaxSendRate ?? 0,
    sentLast24Hours: response.SendQuota?.SentLast24Hours ?? 0,
  }
}

export async function createTemplate(
  client: SESv2Client,
  params: {
    templateName: string
    subjectPart: string
    textPart?: string | null
    htmlPart?: string | null
  }
) {
  const command = new CreateEmailTemplateCommand({
    TemplateName: params.templateName,
    TemplateContent: {
      Subject: params.subjectPart,
      ...(params.textPart ? { Text: params.textPart } : {}),
      ...(params.htmlPart ? { Html: params.htmlPart } : {}),
    },
  })

  await client.send(command)

  return {
    message: `Template '${params.templateName}' created successfully`,
  }
}

export async function getTemplate(client: SESv2Client, templateName: string) {
  const command = new GetEmailTemplateCommand({ TemplateName: templateName })
  const response = await client.send(command)

  return {
    templateName: response.TemplateName ?? '',
    subjectPart: response.TemplateContent?.Subject ?? '',
    textPart: response.TemplateContent?.Text ?? null,
    htmlPart: response.TemplateContent?.Html ?? null,
  }
}

export async function listTemplates(
  client: SESv2Client,
  params: {
    pageSize?: number | null
    nextToken?: string | null
  }
) {
  const command = new ListEmailTemplatesCommand({
    ...(params.pageSize != null ? { PageSize: params.pageSize } : {}),
    ...(params.nextToken ? { NextToken: params.nextToken } : {}),
  })

  const response = await client.send(command)

  const templates = (response.TemplatesMetadata ?? []).map((t) => ({
    templateName: t.TemplateName ?? '',
    createdTimestamp: t.CreatedTimestamp?.toISOString() ?? null,
  }))

  return {
    templates,
    nextToken: response.NextToken ?? null,
    count: templates.length,
  }
}

export async function deleteTemplate(client: SESv2Client, templateName: string) {
  const command = new DeleteEmailTemplateCommand({ TemplateName: templateName })
  await client.send(command)

  return {
    message: `Template '${templateName}' deleted successfully`,
  }
}

export async function updateTemplate(
  client: SESv2Client,
  params: {
    templateName: string
    subjectPart: string
    textPart?: string | null
    htmlPart?: string | null
  }
) {
  const command = new UpdateEmailTemplateCommand({
    TemplateName: params.templateName,
    TemplateContent: {
      Subject: params.subjectPart,
      ...(params.textPart ? { Text: params.textPart } : {}),
      ...(params.htmlPart ? { Html: params.htmlPart } : {}),
    },
  })

  await client.send(command)

  return {
    message: `Template '${params.templateName}' updated successfully`,
  }
}

export async function putSuppressedDestination(
  client: SESv2Client,
  params: { emailAddress: string; reason: SuppressionListReason }
) {
  const command = new PutSuppressedDestinationCommand({
    EmailAddress: params.emailAddress,
    Reason: params.reason,
  })

  await client.send(command)

  return {
    message: `Email address '${params.emailAddress}' added to the suppression list`,
  }
}

export async function deleteSuppressedDestination(client: SESv2Client, emailAddress: string) {
  const command = new DeleteSuppressedDestinationCommand({ EmailAddress: emailAddress })
  await client.send(command)

  return {
    message: `Email address '${emailAddress}' removed from the suppression list`,
  }
}

export async function getSuppressedDestination(client: SESv2Client, emailAddress: string) {
  const command = new GetSuppressedDestinationCommand({ EmailAddress: emailAddress })
  const response = await client.send(command)
  const destination = response.SuppressedDestination

  return {
    emailAddress: destination?.EmailAddress ?? emailAddress,
    reason: destination?.Reason ?? '',
    lastUpdateTime: destination?.LastUpdateTime?.toISOString() ?? null,
    messageId: destination?.Attributes?.MessageId ?? null,
    feedbackId: destination?.Attributes?.FeedbackId ?? null,
  }
}

export async function listSuppressedDestinations(
  client: SESv2Client,
  params: {
    reasons?: SuppressionListReason[] | null
    startDate?: Date | null
    endDate?: Date | null
    pageSize?: number | null
    nextToken?: string | null
  }
) {
  const command = new ListSuppressedDestinationsCommand({
    ...(params.reasons?.length ? { Reasons: params.reasons } : {}),
    ...(params.startDate ? { StartDate: params.startDate } : {}),
    ...(params.endDate ? { EndDate: params.endDate } : {}),
    ...(params.pageSize != null ? { PageSize: params.pageSize } : {}),
    ...(params.nextToken ? { NextToken: params.nextToken } : {}),
  })

  const response = await client.send(command)

  const destinations = (response.SuppressedDestinationSummaries ?? []).map((d) => ({
    emailAddress: d.EmailAddress ?? '',
    reason: d.Reason ?? '',
    lastUpdateTime: d.LastUpdateTime?.toISOString() ?? null,
  }))

  return {
    destinations,
    nextToken: response.NextToken ?? null,
    count: destinations.length,
  }
}

export async function createEmailIdentity(
  client: SESv2Client,
  params: {
    emailIdentity: string
    dkimSigningAttributes?: {
      domainSigningSelector?: string
      domainSigningPrivateKey?: string
      nextSigningKeyLength?: 'RSA_1024_BIT' | 'RSA_2048_BIT'
    } | null
    tags?: Array<{ key: string; value: string }> | null
    configurationSetName?: string | null
  }
) {
  const command = new CreateEmailIdentityCommand({
    EmailIdentity: params.emailIdentity,
    ...(params.dkimSigningAttributes
      ? {
          DkimSigningAttributes: {
            ...(params.dkimSigningAttributes.domainSigningSelector
              ? { DomainSigningSelector: params.dkimSigningAttributes.domainSigningSelector }
              : {}),
            ...(params.dkimSigningAttributes.domainSigningPrivateKey
              ? { DomainSigningPrivateKey: params.dkimSigningAttributes.domainSigningPrivateKey }
              : {}),
            ...(params.dkimSigningAttributes.nextSigningKeyLength
              ? { NextSigningKeyLength: params.dkimSigningAttributes.nextSigningKeyLength }
              : {}),
          },
        }
      : {}),
    ...(params.tags?.length
      ? { Tags: params.tags.map((t) => ({ Key: t.key, Value: t.value })) }
      : {}),
    ...(params.configurationSetName ? { ConfigurationSetName: params.configurationSetName } : {}),
  })

  const response = await client.send(command)

  return {
    identityType: response.IdentityType ?? '',
    verifiedForSendingStatus: response.VerifiedForSendingStatus ?? false,
    dkimAttributes: response.DkimAttributes
      ? {
          signingEnabled: response.DkimAttributes.SigningEnabled ?? null,
          status: response.DkimAttributes.Status ?? null,
          tokens: response.DkimAttributes.Tokens ?? [],
          signingAttributesOrigin: response.DkimAttributes.SigningAttributesOrigin ?? null,
          nextSigningKeyLength: response.DkimAttributes.NextSigningKeyLength ?? null,
          currentSigningKeyLength: response.DkimAttributes.CurrentSigningKeyLength ?? null,
          lastKeyGenerationTimestamp:
            response.DkimAttributes.LastKeyGenerationTimestamp?.toISOString() ?? null,
          signingHostedZone: response.DkimAttributes.SigningHostedZone ?? null,
        }
      : null,
  }
}

export async function deleteEmailIdentity(client: SESv2Client, emailIdentity: string) {
  const command = new DeleteEmailIdentityCommand({ EmailIdentity: emailIdentity })
  await client.send(command)

  return {
    message: `Email identity '${emailIdentity}' deleted successfully`,
  }
}

export async function getEmailIdentity(client: SESv2Client, emailIdentity: string) {
  const command = new GetEmailIdentityCommand({ EmailIdentity: emailIdentity })
  const response = await client.send(command)

  return {
    identityType: response.IdentityType ?? '',
    verifiedForSendingStatus: response.VerifiedForSendingStatus ?? false,
    verificationStatus: response.VerificationStatus ?? null,
    feedbackForwardingStatus: response.FeedbackForwardingStatus ?? null,
    configurationSetName: response.ConfigurationSetName ?? null,
    dkimAttributes: response.DkimAttributes
      ? {
          signingEnabled: response.DkimAttributes.SigningEnabled ?? null,
          status: response.DkimAttributes.Status ?? null,
          tokens: response.DkimAttributes.Tokens ?? [],
          signingAttributesOrigin: response.DkimAttributes.SigningAttributesOrigin ?? null,
          nextSigningKeyLength: response.DkimAttributes.NextSigningKeyLength ?? null,
          currentSigningKeyLength: response.DkimAttributes.CurrentSigningKeyLength ?? null,
          lastKeyGenerationTimestamp:
            response.DkimAttributes.LastKeyGenerationTimestamp?.toISOString() ?? null,
          signingHostedZone: response.DkimAttributes.SigningHostedZone ?? null,
        }
      : null,
    mailFromAttributes: response.MailFromAttributes
      ? {
          mailFromDomain: response.MailFromAttributes.MailFromDomain ?? null,
          mailFromDomainStatus: response.MailFromAttributes.MailFromDomainStatus ?? null,
          behaviorOnMxFailure: response.MailFromAttributes.BehaviorOnMxFailure ?? null,
        }
      : null,
    policies: response.Policies ?? null,
    tags: (response.Tags ?? []).map((t) => ({ key: t.Key ?? '', value: t.Value ?? '' })),
    verificationInfo: response.VerificationInfo
      ? {
          errorType: response.VerificationInfo.ErrorType ?? null,
          lastCheckedTimestamp:
            response.VerificationInfo.LastCheckedTimestamp?.toISOString() ?? null,
          lastSuccessTimestamp:
            response.VerificationInfo.LastSuccessTimestamp?.toISOString() ?? null,
        }
      : null,
  }
}

export async function createConfigurationSet(
  client: SESv2Client,
  params: {
    configurationSetName: string
    customRedirectDomain?: string | null
    httpsPolicy?: 'REQUIRE' | 'REQUIRE_OPEN_ONLY' | 'OPTIONAL' | null
    tlsPolicy?: TlsPolicy | null
    sendingPoolName?: string | null
    reputationMetricsEnabled?: boolean | null
    sendingEnabled?: boolean | null
    suppressedReasons?: SuppressionListReason[] | null
    tags?: Array<{ key: string; value: string }> | null
  }
) {
  const command = new CreateConfigurationSetCommand({
    ConfigurationSetName: params.configurationSetName,
    ...(params.customRedirectDomain
      ? {
          TrackingOptions: {
            CustomRedirectDomain: params.customRedirectDomain,
            ...(params.httpsPolicy ? { HttpsPolicy: params.httpsPolicy } : {}),
          },
        }
      : {}),
    ...(params.tlsPolicy || params.sendingPoolName
      ? {
          DeliveryOptions: {
            ...(params.tlsPolicy ? { TlsPolicy: params.tlsPolicy } : {}),
            ...(params.sendingPoolName ? { SendingPoolName: params.sendingPoolName } : {}),
          },
        }
      : {}),
    ...(params.reputationMetricsEnabled != null
      ? { ReputationOptions: { ReputationMetricsEnabled: params.reputationMetricsEnabled } }
      : {}),
    ...(params.sendingEnabled != null
      ? { SendingOptions: { SendingEnabled: params.sendingEnabled } }
      : {}),
    ...(params.suppressedReasons?.length
      ? { SuppressionOptions: { SuppressedReasons: params.suppressedReasons } }
      : {}),
    ...(params.tags?.length
      ? { Tags: params.tags.map((t) => ({ Key: t.key, Value: t.value })) }
      : {}),
  })

  await client.send(command)

  return {
    message: `Configuration set '${params.configurationSetName}' created successfully`,
  }
}

export async function sendCustomVerificationEmail(
  client: SESv2Client,
  params: {
    emailAddress: string
    templateName: string
    configurationSetName?: string | null
  }
) {
  const command = new SendCustomVerificationEmailCommand({
    EmailAddress: params.emailAddress,
    TemplateName: params.templateName,
    ...(params.configurationSetName ? { ConfigurationSetName: params.configurationSetName } : {}),
  })

  const response = await client.send(command)

  return {
    messageId: response.MessageId ?? '',
  }
}
