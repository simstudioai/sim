import type {
  AppConfigCreateVersionParams,
  AppConfigCreateVersionResponse,
} from '@/tools/appconfig/types'
import type { ToolConfig } from '@/tools/types'

export const createHostedConfigurationVersionTool: ToolConfig<
  AppConfigCreateVersionParams,
  AppConfigCreateVersionResponse
> = {
  id: 'appconfig_create_hosted_configuration_version',
  name: 'AppConfig Create Hosted Configuration Version',
  description: 'Create a new immutable hosted configuration version for an AppConfig profile',
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
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The configuration content (e.g., JSON or YAML text)',
    },
    contentType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'A standard MIME type for the content (e.g., application/json)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A description of the configuration version',
    },
    versionLabel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'An optional user-defined label (e.g., "v2.2.0")',
    },
    latestVersionNumber: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional locking token — the latest version number to prevent overwrites',
    },
  },

  request: {
    url: '/api/tools/appconfig/create-hosted-configuration-version',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      applicationId: params.applicationId,
      configurationProfileId: params.configurationProfileId,
      content: params.content,
      contentType: params.contentType,
      ...(params.description !== undefined && { description: params.description }),
      ...(params.versionLabel !== undefined && { versionLabel: params.versionLabel }),
      ...(params.latestVersionNumber !== undefined && {
        latestVersionNumber: params.latestVersionNumber,
      }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'AppConfig create hosted configuration version failed')
    }
    return { success: true, output: data }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    applicationId: { type: 'string', description: 'The application ID', optional: true },
    configurationProfileId: {
      type: 'string',
      description: 'The configuration profile ID',
      optional: true,
    },
    versionNumber: {
      type: 'number',
      description: 'The created version number',
      optional: true,
    },
    contentType: { type: 'string', description: 'The content MIME type', optional: true },
    description: { type: 'string', description: 'The version description', optional: true },
    versionLabel: { type: 'string', description: 'The version label', optional: true },
  },
}
