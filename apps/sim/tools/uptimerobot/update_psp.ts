import type { ToolConfig } from '@/tools/types'
import {
  PSP_OUTPUT_PROPERTIES,
  type UptimeRobotPspResponse,
  type UptimeRobotUpdatePspParams,
} from '@/tools/uptimerobot/types'

export const uptimeRobotUpdatePspTool: ToolConfig<
  UptimeRobotUpdatePspParams,
  UptimeRobotPspResponse
> = {
  id: 'uptimerobot_update_psp',
  name: 'UptimeRobot Update Status Page',
  description:
    'Update a public status page in UptimeRobot. Only the provided fields are changed; logo and icon images can be replaced.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
    pspId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the status page to update',
    },
    friendlyName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name of the public status page',
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
    url: '/api/tools/uptimerobot/update-psp',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      pspId: params.pspId,
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
      throw new Error(data.error || 'Failed to update status page')
    }
    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    psp: {
      type: 'object',
      description: 'The updated status page',
      properties: PSP_OUTPUT_PROPERTIES,
    },
  },
}
