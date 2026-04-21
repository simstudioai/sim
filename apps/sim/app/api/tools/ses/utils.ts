import {
  CreateEmailTemplateCommand,
  DeleteEmailTemplateCommand,
  GetAccountCommand,
  GetEmailTemplateCommand,
  ListEmailIdentitiesCommand,
  ListEmailTemplatesCommand,
  SESv2Client,
  SendBulkEmailCommand,
  SendEmailCommand,
} from '@aws-sdk/client-sesv2'
import type { SESConnectionConfig } from '@/tools/ses/types'

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

export async function sendBulkEmail(
  client: SESv2Client,
  params: {
    fromAddress: string
    templateName: string
    destinations: Array<{ toAddresses: string[]; templateData?: string }>
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
