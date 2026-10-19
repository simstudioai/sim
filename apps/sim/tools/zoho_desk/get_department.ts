import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import { ZOHO_DESK_DEPARTMENT_PROPERTIES } from '@/tools/zoho_desk/outputs'
import {
  projectZohoDeskResource,
  readZohoDeskResponse,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type {
  ZohoDeskGetDepartmentParams,
  ZohoDeskGetDepartmentResponse,
} from '@/tools/zoho_desk/types'
import { buildZohoDeskHeaders, getZohoDeskApiBase } from '@/tools/zoho_desk/utils'

export const zohoDeskGetDepartmentTool: ToolConfig<
  ZohoDeskGetDepartmentParams,
  ZohoDeskGetDepartmentResponse
> = {
  id: 'zoho_desk_get_department',
  name: 'Zoho Desk Get Department',
  description: 'Get Department in Zoho Desk.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
    lookupDepartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the department',
    },
  },
  request: {
    url: (params) => {
      return `${getZohoDeskApiBase(params)}/departments/${safeUrlPathSegment(params.lookupDepartmentId, 'lookupDepartmentId')}`
    },
    method: 'GET',
    headers: buildZohoDeskHeaders,
  },
  transformResponse: async (response) => {
    const data = await readZohoDeskResponse(response)
    return {
      success: true,
      output: { department: projectZohoDeskResource(data, ZOHO_DESK_DEPARTMENT_PROPERTIES) },
    }
  },
  outputs: {
    department: {
      type: 'object',
      description: 'The department',
      properties: ZOHO_DESK_DEPARTMENT_PROPERTIES,
    },
  },
}
