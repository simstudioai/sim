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

export interface SESPutSuppressedDestinationParams extends SESConnectionConfig {
  emailAddress: string
  reason: 'BOUNCE' | 'COMPLAINT'
}

export interface SESPutSuppressedDestinationResponse extends ToolResponse {
  output: {
    message: string
  }
}

export interface SESDeleteSuppressedDestinationParams extends SESConnectionConfig {
  emailAddress: string
}

export interface SESDeleteSuppressedDestinationResponse extends ToolResponse {
  output: {
    message: string
  }
}

export interface SESGetSuppressedDestinationParams extends SESConnectionConfig {
  emailAddress: string
}

export interface SESGetSuppressedDestinationResponse extends ToolResponse {
  output: {
    emailAddress: string
    reason: string
    lastUpdateTime: string | null
    messageId: string | null
    feedbackId: string | null
  }
}

export interface SESListSuppressedDestinationsParams extends SESConnectionConfig {
  reasons?: string | null
  startDate?: string | null
  endDate?: string | null
  pageSize?: number | null
  nextToken?: string | null
}

export interface SESListSuppressedDestinationsResponse extends ToolResponse {
  output: {
    destinations: Array<{
      emailAddress: string
      reason: string
      lastUpdateTime: string | null
    }>
    nextToken: string | null
    count: number
  }
}

export interface SESCreateEmailIdentityParams extends SESConnectionConfig {
  emailIdentity: string
  dkimSigningAttributes?: {
    domainSigningSelector?: string
    domainSigningPrivateKey?: string
    nextSigningKeyLength?: 'RSA_1024_BIT' | 'RSA_2048_BIT'
  } | null
  tags?: Array<{ key: string; value: string }> | null
  configurationSetName?: string | null
}

export interface SESCreateEmailIdentityResponse extends ToolResponse {
  output: {
    identityType: string
    verifiedForSendingStatus: boolean
    dkimAttributes: {
      signingEnabled: boolean | null
      status: string | null
      tokens: string[]
      signingAttributesOrigin: string | null
      nextSigningKeyLength: string | null
      currentSigningKeyLength: string | null
      lastKeyGenerationTimestamp: string | null
      signingHostedZone: string | null
    } | null
  }
}

export interface SESDeleteEmailIdentityParams extends SESConnectionConfig {
  emailIdentity: string
}

export interface SESDeleteEmailIdentityResponse extends ToolResponse {
  output: {
    message: string
  }
}

export interface SESGetEmailIdentityParams extends SESConnectionConfig {
  emailIdentity: string
}

export interface SESGetEmailIdentityResponse extends ToolResponse {
  output: {
    identityType: string
    verifiedForSendingStatus: boolean
    verificationStatus: string | null
    feedbackForwardingStatus: boolean | null
    configurationSetName: string | null
    dkimAttributes: {
      signingEnabled: boolean | null
      status: string | null
      tokens: string[]
      signingAttributesOrigin: string | null
      nextSigningKeyLength: string | null
      currentSigningKeyLength: string | null
      lastKeyGenerationTimestamp: string | null
      signingHostedZone: string | null
    } | null
    mailFromAttributes: {
      mailFromDomain: string | null
      mailFromDomainStatus: string | null
      behaviorOnMxFailure: string | null
    } | null
    policies: Record<string, string> | null
    tags: Array<{ key: string; value: string }>
    verificationInfo: {
      errorType: string | null
      lastCheckedTimestamp: string | null
      lastSuccessTimestamp: string | null
    } | null
  }
}

export interface SESUpdateTemplateParams extends SESConnectionConfig {
  templateName: string
  subjectPart: string
  textPart?: string | null
  htmlPart?: string | null
}

export interface SESUpdateTemplateResponse extends ToolResponse {
  output: {
    message: string
  }
}

export interface SESCreateConfigurationSetParams extends SESConnectionConfig {
  configurationSetName: string
  customRedirectDomain?: string | null
  httpsPolicy?: 'REQUIRE' | 'REQUIRE_OPEN_ONLY' | 'OPTIONAL' | null
  tlsPolicy?: 'REQUIRE' | 'OPTIONAL' | null
  sendingPoolName?: string | null
  reputationMetricsEnabled?: boolean | null
  sendingEnabled?: boolean | null
  suppressedReasons?: string | null
  tags?: Array<{ key: string; value: string }> | null
}

export interface SESCreateConfigurationSetResponse extends ToolResponse {
  output: {
    message: string
  }
}

export interface SESSendCustomVerificationEmailParams extends SESConnectionConfig {
  emailAddress: string
  templateName: string
  configurationSetName?: string | null
}

export interface SESSendCustomVerificationEmailResponse extends ToolResponse {
  output: {
    messageId: string
  }
}

interface SESBaseResponse extends ToolResponse {
  output: { message: string }
}
