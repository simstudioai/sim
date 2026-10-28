import type { ToolConfig } from '@/tools/types'
import { ZOHO_DESK_AGENT_PROPERTIES } from '@/tools/zoho_desk/outputs'
import {
  projectZohoDeskResource,
  readZohoDeskList,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type { ZohoDeskListAgentsParams, ZohoDeskListAgentsResponse } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  normalizeZohoDeskCommaList,
} from '@/tools/zoho_desk/utils'

export const zohoDeskListAgentsTool: ToolConfig<
  ZohoDeskListAgentsParams,
  ZohoDeskListAgentsResponse
> = {
  id: 'zoho_desk_list_agents',
  name: 'Zoho Desk List Agents',
  description: 'List Agents in Zoho Desk.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
    agentListInclude: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Secondary information related to agents, The allowed values are profile, role. You can include all two values by separating them with commas in the API request.',
    },
    roleIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated array of role IDs. Maximum number of IDs allowed is 50. Comma-separated values.',
    },
    searchStr: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'String to search for agents by first name, last name, or email ID. The string must contain at least one character. The supported search methods: 1) string* - Searches for agents whose first name, last name, or email ID start with the string, 2) *string* - Searches for agents whose first name, last name, or email ID contain the string, 3) string - Searches for agents whose first name, last name, or email ID is an. Exact match. for the string',
    },
    cfSearchStr: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'String to search for agents by custom field. The string must contain at least one character',
    },
    cfFieldName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'API name of the custom field that must be used for searching and listing agents',
    },
    fieldName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Name of the field that must be used for searching and listing agents. The allowed values are: firstName, lastName, name, and emailId',
    },
    isLightAgent: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Key that denotes if the agents must be light or non light.',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'To sort the available list of agents in either ascending or descending order. The allowed values are: asc or desc',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page size (0-200; default 10).',
    },
    rolePermissionType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: `Types of roles and permissions of the agents to list. The allowed values are AgentPublic, AgentPersonal,AgentTeamPersonal, Admin, Light, Custom, and \${NON_LIGHT}. \${NON_LIGHT} refers to agents who are not associated with the light agent profile.`,
    },
    profileIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated array of profile IDs. Maximum number of IDs allowed is 50. Comma-separated values.',
    },
    from: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination start index (0-based).',
    },
    isConfirmed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Key that denotes if the agents must be confirmed or unconfirmed.',
    },
    departmentIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated array of department IDs. Maximum number of IDs allowed is 50. Comma-separated values.',
    },
    agentStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Key that filters agents based on their activation status: ACTIVE, DISABLED, DELETED or IMPORTED',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams({ from: String(params.from ?? 0) })
      if (params.agentListInclude != null && params.agentListInclude !== '') {
        const value = normalizeZohoDeskCommaList(params.agentListInclude)
        if (value !== undefined) query.set('include', String(value))
      }
      if (params.roleIds != null && params.roleIds !== '') {
        const value = normalizeZohoDeskCommaList(params.roleIds)
        if (value !== undefined) query.set('roleIds', String(value))
      }
      if (params.searchStr != null && params.searchStr !== '') {
        query.set('searchStr', String(params.searchStr))
      }
      if (params.cfSearchStr != null && params.cfSearchStr !== '') {
        query.set('cfSearchStr', String(params.cfSearchStr))
      }
      if (params.cfFieldName != null && params.cfFieldName !== '') {
        query.set('cfFieldName', String(params.cfFieldName))
      }
      if (params.fieldName != null && params.fieldName !== '') {
        query.set('fieldName', String(params.fieldName))
      }
      if (params.isLightAgent != null) query.set('isLightAgent', String(params.isLightAgent))
      if (params.sortOrder != null && params.sortOrder !== '') {
        query.set('sortOrder', String(params.sortOrder))
      }
      if (params.limit != null) {
        const value = Number(params.limit)
        if (!Number.isInteger(value) || value < 0 || value > 200)
          throw new Error('limit is outside the documented range')
        query.set('limit', String(value))
      }
      if (params.rolePermissionType != null && params.rolePermissionType !== '') {
        query.set('rolePermissionType', String(params.rolePermissionType))
      }
      if (params.profileIds != null && params.profileIds !== '') {
        const value = normalizeZohoDeskCommaList(params.profileIds)
        if (value !== undefined) query.set('profileIds', String(value))
      }
      if (params.from != null) {
        const value = Number(params.from)
        if (!Number.isInteger(value) || value < 0)
          throw new Error('from is outside the documented range')
        query.set('from', String(value))
      }
      if (params.isConfirmed != null) query.set('isConfirmed', String(params.isConfirmed))
      if (params.departmentIds != null && params.departmentIds !== '') {
        const value = normalizeZohoDeskCommaList(params.departmentIds)
        if (value !== undefined) query.set('departmentIds', String(value))
      }
      if (params.agentStatus != null && params.agentStatus !== '') {
        query.set('status', String(params.agentStatus))
      }
      return `${getZohoDeskApiBase(params)}/agents${query.size ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: buildZohoDeskHeaders,
  },
  transformResponse: async (response, params) => {
    const { items } = await readZohoDeskList(response)
    return {
      success: true,
      output: {
        agents: items.map((item) => projectZohoDeskResource(item, ZOHO_DESK_AGENT_PROPERTIES)),
        count: items.length,
        nextFrom: items.length ? Number(params?.from ?? 0) + items.length : null,
      },
    }
  },
  outputs: {
    agents: {
      type: 'array',
      description: 'List Agents results',
      items: { type: 'object', properties: ZOHO_DESK_AGENT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of results in this page' },
    nextFrom: {
      type: 'number',
      nullable: true,
      description:
        'Next index to request; null when this page is empty. The next request may return an empty page.',
    },
  },
}
