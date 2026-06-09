import type {
  AppConfigGetVersionParams,
  AppConfigGetVersionResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const getHostedConfigurationVersionTool: ToolConfig<
  AppConfigGetVersionParams,
  AppConfigGetVersionResponse
> = {
  id: 'appconfig_get_hosted_configuration_version',
  name: 'AppConfig Get Hosted Configuration Version',
  description: 'Retrieve the content of a specific hosted configuration version',
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
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The AppConfig application ID',
    },
    configurationProfileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The configuration profile ID',
    },
    versionNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The version number to retrieve',
    },
  },

  request: {
    url: '/api/tools/appconfig/get-hosted-configuration-version',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      configurationProfileId: params.configurationProfileId,
      versionNumber: params.versionNumber,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'AppConfig get hosted configuration version failed')
    }
    return { success: true, output: data }
  },

  outputs: {
    applicationId: { type: 'string', description: 'The application ID', optional: true },
    configurationProfileId: {
      type: 'string',
      description: 'The configuration profile ID',
      optional: true,
    },
    versionNumber: { type: 'number', description: 'The version number', optional: true },
    content: { type: 'string', description: 'The configuration content', optional: true },
    contentType: { type: 'string', description: 'The content MIME type', optional: true },
    description: { type: 'string', description: 'The version description', optional: true },
    versionLabel: { type: 'string', description: 'The version label', optional: true },
  },
}
