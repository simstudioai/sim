import type {
  SESCreateConfigurationSetParams,
  SESCreateConfigurationSetResponse,
} from '@/tools/ses/types'
import type { ToolConfig } from '@/tools/types'

export const createConfigurationSetTool: ToolConfig<
  SESCreateConfigurationSetParams,
  SESCreateConfigurationSetResponse
> = {
  id: 'ses_create_configuration_set',
  name: 'SES Create Configuration Set',
  description:
    'Create an SES configuration set to control tracking, delivery, reputation, sending, and suppression behavior for emails',
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
    configurationSetName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the configuration set (letters, numbers, hyphens, underscores)',
    },
    customRedirectDomain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom domain to use for open/click tracking links',
    },
    httpsPolicy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTTPS policy for tracking links: REQUIRE, REQUIRE_OPEN_ONLY, or OPTIONAL',
    },
    tlsPolicy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether delivery requires TLS: REQUIRE or OPTIONAL',
    },
    sendingPoolName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Dedicated IP pool to associate with the configuration set',
    },
    reputationMetricsEnabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to collect reputation metrics for emails using this configuration set',
    },
    sendingEnabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether sending is enabled for this configuration set',
    },
    suppressedReasons: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated reasons that trigger suppression: BOUNCE, COMPLAINT',
    },
    tags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of tags to associate with the configuration set: [{"key":"","value":""}]',
    },
  },

  request: {
    url: '/api/tools/ses/create-configuration-set',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      configurationSetName: params.configurationSetName,
      customRedirectDomain: params.customRedirectDomain,
      httpsPolicy: params.httpsPolicy,
      tlsPolicy: params.tlsPolicy,
      sendingPoolName: params.sendingPoolName,
      reputationMetricsEnabled: params.reputationMetricsEnabled,
      sendingEnabled: params.sendingEnabled,
      suppressedReasons: params.suppressedReasons,
      tags: params.tags,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create configuration set')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Confirmation message' },
  },
}
