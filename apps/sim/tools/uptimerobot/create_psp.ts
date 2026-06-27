import type { ToolConfig } from '@/tools/types'
import {
  PSP_OUTPUT_PROPERTIES,
  type UptimeRobotCreatePspParams,
  type UptimeRobotPspResponse,
} from '@/tools/uptimerobot/types'

export const uptimeRobotCreatePspTool: ToolConfig<
  UptimeRobotCreatePspParams,
  UptimeRobotPspResponse
> = {
  id: 'uptimerobot_create_psp',
  name: 'UptimeRobot Create Status Page',
  description: 'Create a public status page in UptimeRobot, optionally with a logo and icon image',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
    friendlyName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the public status page',
    },
    monitorIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated monitor IDs to display on the page',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Status of the page: ENABLED (published) or PAUSED (unpublished)',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional password protection for the page',
    },
    customDomain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom domain for the page (e.g. status.your-domain.com)',
    },
    hideUrlLinks: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to hide the "Powered by UptimeRobot" footer link',
    },
    noIndex: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to prevent search engines from indexing the page',
    },
    logo: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'Logo image (JPG/JPEG/PNG, max 150 KB)',
    },
    icon: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'Icon image (JPG/JPEG/PNG, max 150 KB)',
    },
  },

  request: {
    url: '/api/tools/uptimerobot/create-psp',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      friendlyName: params.friendlyName,
      monitorIds: params.monitorIds,
      status: params.status,
      password: params.password,
      customDomain: params.customDomain,
      hideUrlLinks: params.hideUrlLinks,
      noIndex: params.noIndex,
      logo: params.logo,
      icon: params.icon,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to create status page')
    }
    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    psp: {
      type: 'object',
      description: 'The created status page',
      properties: PSP_OUTPUT_PROPERTIES,
    },
  },
}
