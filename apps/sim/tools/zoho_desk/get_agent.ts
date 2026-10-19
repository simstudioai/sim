import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import { ZOHO_DESK_AGENT_PROPERTIES } from '@/tools/zoho_desk/outputs'
import {
  projectZohoDeskResource,
  readZohoDeskResponse,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type { ZohoDeskGetAgentParams, ZohoDeskGetAgentResponse } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  normalizeZohoDeskCommaList,
} from '@/tools/zoho_desk/utils'

export const zohoDeskGetAgentTool: ToolConfig<ZohoDeskGetAgentParams, ZohoDeskGetAgentResponse> = {
  id: 'zoho_desk_get_agent',
  name: 'Zoho Desk Get Agent',
  description: 'Get Agent in Zoho Desk.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
    agentInclude: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Secondary information related to the agent. Values allowed are profile, role, associatedDepartments, associatedChatDepartments and verifiedEmails. Separate multiple values with commas.',
    },
    agentId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Agent ID' },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.agentInclude != null && params.agentInclude !== '') {
        const value = normalizeZohoDeskCommaList(params.agentInclude)
        if (value !== undefined) query.set('include', String(value))
      }
      return `${getZohoDeskApiBase(params)}/agents/${safeUrlPathSegment(params.agentId, 'agentId')}${query.size ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: buildZohoDeskHeaders,
  },
  transformResponse: async (response) => {
    const data = await readZohoDeskResponse(response)
    return {
      success: true,
      output: { agent: projectZohoDeskResource(data, ZOHO_DESK_AGENT_PROPERTIES) },
    }
  },
  outputs: {
    agent: { type: 'object', description: 'The agent', properties: ZOHO_DESK_AGENT_PROPERTIES },
  },
}
