import type { ToolResponse } from '@/tools/types'

export interface SESConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export interface SESSendEmailParams extends SESConnectionConfig {
  fromAddress: string
  toAddresses: string
  subject: string
  bodyText?: string | null
  bodyHtml?: string | null
  ccAddresses?: string | null
  bccAddresses?: string | null
  replyToAddresses?: string | null
  configurationSetName?: string | null
}

export interface SESSendTemplatedEmailParams extends SESConnectionConfig {
  fromAddress: string
  toAddresses: string
  templateName: string
  templateData: string
  ccAddresses?: string | null
  bccAddresses?: string | null
  configurationSetName?: string | null
}

export interface SESSendBulkEmailParams extends SESConnectionConfig {
  fromAddress: string
  templateName: string
  destinations: string
  defaultTemplateData?: string | null
  configurationSetName?: string | null
}

export interface SESListIdentitiesParams extends SESConnectionConfig {
  pageSize?: number | null
  nextToken?: string | null
}

export interface SESGetAccountParams extends SESConnectionConfig {}

export interface SESCreateTemplateParams extends SESConnectionConfig {
  templateName: string
  subjectPart: string
  textPart?: string | null
  htmlPart?: string | null
}

export interface SESGetTemplateParams extends SESConnectionConfig {
  templateName: string
}

export interface SESListTemplatesParams extends SESConnectionConfig {
  pageSize?: number | null
  nextToken?: string | null
}

export interface SESDeleteTemplateParams extends SESConnectionConfig {
  templateName: string
}

export interface SESSendEmailResponse extends ToolResponse {
  output: {
    messageId: string
  }
}

export interface SESSendTemplatedEmailResponse extends ToolResponse {
  output: {
    messageId: string
  }
}

export interface SESSendBulkEmailResponse extends ToolResponse {
  output: {
    results: Array<{
      messageId: string | null
      status: string
      error: string | null
    }>
    successCount: number
    failureCount: number
  }
}

export interface SESListIdentitiesResponse extends ToolResponse {
  output: {
    identities: Array<{
      identityName: string
      identityType: string
      sendingEnabled: boolean
      verificationStatus: string
    }>
    nextToken: string | null
    count: number
  }
}

export interface SESGetAccountResponse extends ToolResponse {
  output: {
    sendingEnabled: boolean
    max24HourSend: number
    maxSendRate: number
    sentLast24Hours: number
  }
}

export interface SESCreateTemplateResponse extends ToolResponse {
  output: {
    message: string
  }
}

export interface SESGetTemplateResponse extends ToolResponse {
  output: {
    templateName: string
    subjectPart: string
    textPart: string | null
    htmlPart: string | null
  }
}

export interface SESListTemplatesResponse extends ToolResponse {
  output: {
    templates: Array<{
      templateName: string
      createdTimestamp: string | null
    }>
    nextToken: string | null
    count: number
  }
}

export interface SESDeleteTemplateResponse extends ToolResponse {
  output: {
    message: string
  }
}

export interface SESBaseResponse extends ToolResponse {
  output: { message: string }
}
