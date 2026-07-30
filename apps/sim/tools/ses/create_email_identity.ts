import type {
  SESCreateEmailIdentityParams,
  SESCreateEmailIdentityResponse,
} from '@/tools/ses/types'
import type { ToolConfig } from '@/tools/types'

export const createEmailIdentityTool: ToolConfig<
  SESCreateEmailIdentityParams,
  SESCreateEmailIdentityResponse
> = {
  id: 'ses_create_email_identity',
  name: 'SES Create Email Identity',
  description: 'Start verification of a new SES email address or domain identity',
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
      description: 'The email address or domain to verify',
    },
    dkimSigningAttributes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Bring-your-own-DKIM signing attributes as JSON (domainSigningSelector, domainSigningPrivateKey, nextSigningKeyLength). Domain identities only.',
    },
    tags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of tags to associate with the identity: [{"key":"","value":""}]',
    },
    configurationSetName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Default configuration set to use when sending from this identity',
    },
  },

  request: {
    url: '/api/tools/ses/create-email-identity',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      emailIdentity: params.emailIdentity,
      dkimSigningAttributes: params.dkimSigningAttributes,
      tags: params.tags,
      configurationSetName: params.configurationSetName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create email identity')
    }

    return {
      success: true,
      output: {
        identityType: data.identityType ?? '',
        verifiedForSendingStatus: data.verifiedForSendingStatus ?? false,
        dkimAttributes: data.dkimAttributes ?? null,
      },
    }
  },

  outputs: {
    identityType: { type: 'string', description: 'The identity type: EMAIL_ADDRESS or DOMAIN' },
    verifiedForSendingStatus: {
      type: 'boolean',
      description: 'Whether the identity is verified and can send email',
    },
    dkimAttributes: {
      type: 'json',
      description: 'DKIM signing status and CNAME tokens for the identity',
      optional: true,
    },
  },
}
