import type { SESGetEmailIdentityParams, SESGetEmailIdentityResponse } from '@/tools/ses/types'
import type { ToolConfig } from '@/tools/types'

export const getEmailIdentityTool: ToolConfig<
  SESGetEmailIdentityParams,
  SESGetEmailIdentityResponse
> = {
  id: 'ses_get_email_identity',
  name: 'SES Get Email Identity',
  description:
    'Retrieve verification status, DKIM, Mail-From, and policy details for an SES identity',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    emailIdentity: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The email address or domain identity to look up',
    },
  },

  request: {
    url: '/api/tools/ses/get-email-identity',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      emailIdentity: params.emailIdentity,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get email identity')
    }

    return {
      success: true,
      output: {
        identityType: data.identityType ?? '',
        verifiedForSendingStatus: data.verifiedForSendingStatus ?? false,
        verificationStatus: data.verificationStatus ?? null,
        feedbackForwardingStatus: data.feedbackForwardingStatus ?? null,
        configurationSetName: data.configurationSetName ?? null,
        dkimAttributes: data.dkimAttributes ?? null,
        mailFromAttributes: data.mailFromAttributes ?? null,
        policies: data.policies ?? null,
        tags: data.tags ?? [],
        verificationInfo: data.verificationInfo ?? null,
      },
    }
  },

  outputs: {
    identityType: { type: 'string', description: 'The identity type: EMAIL_ADDRESS or DOMAIN' },
    verifiedForSendingStatus: {
      type: 'boolean',
      description: 'Whether the identity is verified and can send email',
    },
    verificationStatus: {
      type: 'string',
      description: 'Verification status: PENDING, SUCCESS, FAILED, TEMPORARY_FAILURE, NOT_STARTED',
      optional: true,
    },
    feedbackForwardingStatus: {
      type: 'boolean',
      description: 'Whether bounce/complaint notifications are forwarded by email',
      optional: true,
    },
    configurationSetName: {
      type: 'string',
      description: 'Default configuration set for this identity',
      optional: true,
    },
    dkimAttributes: {
      type: 'json',
      description: 'DKIM signing status and CNAME tokens for the identity',
      optional: true,
    },
    mailFromAttributes: {
      type: 'json',
      description: 'Custom MAIL FROM domain configuration for the identity',
      optional: true,
    },
    policies: {
      type: 'json',
      description: 'Sending authorization policies attached to the identity',
      optional: true,
    },
    tags: { type: 'array', description: 'Tags associated with the identity' },
    verificationInfo: {
      type: 'json',
      description: 'Additional verification diagnostics (error type, last checked/success time)',
      optional: true,
    },
  },
}
