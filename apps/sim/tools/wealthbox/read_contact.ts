import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { WealthboxReadResponse , WealthboxReadParams } from './types'

const logger = createLogger('WealthboxReadContact')

export const wealthboxReadContactTool: ToolConfig<WealthboxReadParams, WealthboxReadResponse> = {
  id: 'wealthbox_read_contact',
  name: 'Read Wealthbox Contact',
  description: 'Read content from a Wealthbox contact',
  version: '1.1',
  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'The access token for the Wealthbox API',
    },
  },
  request: {
    method: 'GET',
    url: 'https://api.wealthbox.com/v1/contacts',
    headers: (params) => ({
      'Authorization': `Bearer ${params.accessToken}`,
    }),
  },
}