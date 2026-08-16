import { authParams } from '@/tools/servicenow/params'
import type { ServiceNowGetCiParams, ServiceNowGetCiResponse } from '@/tools/servicenow/types'
import {
  buildServiceNowHeaders,
  normalizeInstanceUrl,
  parseServiceNowResponse,
  readRecord,
  readRecordArray,
  toRecordObject,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

export const getCiTool: ToolConfig<ServiceNowGetCiParams, ServiceNowGetCiResponse> = {
  id: 'servicenow_get_ci',
  name: 'Get ServiceNow Configuration Item',
  description:
    'Retrieve a configuration item and its CMDB relationships through the CMDB Instance API. Returns the CI attributes plus its inbound and outbound relations, each carrying the related CI and the relationship type.',
  version: '1.0.0',

  params: {
    ...authParams,
    ciClass: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'CMDB class (table) the CI belongs to, e.g., cmdb_ci_linux_server. Read it from the sys_class_name field returned by Search ServiceNow Configuration Items.',
    },
    sysId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'sys_id of the configuration item to retrieve.',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const ciClass = params.ciClass?.trim()
      const sysId = params.sysId?.trim()
      if (!ciClass) throw new Error('A CMDB class name is required')
      if (!sysId) throw new Error('A configuration item sys_id is required')
      return `${baseUrl}/api/now/cmdb/instance/${ciClass}/${sysId}`
    },
    method: 'GET',
    headers: (params) => buildServiceNowHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await parseServiceNowResponse(response)
    const result = toRecordObject(data.result)
    const inboundRelations = readRecordArray(result, 'inbound_relations')
    const outboundRelations = readRecordArray(result, 'outbound_relations')

    return {
      success: true,
      output: {
        attributes: readRecord(result, 'attributes'),
        inboundRelations,
        outboundRelations,
        metadata: {
          inboundCount: inboundRelations.length,
          outboundCount: outboundRelations.length,
        },
      },
    }
  },

  outputs: {
    attributes: {
      type: 'json',
      description:
        'Data attributes on the CI record. The available attributes depend on the class.',
      nullable: true,
    },
    inboundRelations: {
      type: 'array',
      description: 'Inbound CI relationships',
      items: {
        type: 'object',
        properties: {
          sys_id: {
            type: 'string',
            description: 'Sys_id of the relationship record on cmdb_rel_ci',
          },
          target: {
            type: 'json',
            description: 'Related CI as {value (sys_id), display_value, link}',
          },
          type: {
            type: 'json',
            description: 'Relationship type as {value (sys_id), display_value, link}',
          },
        },
      },
    },
    outboundRelations: {
      type: 'array',
      description: 'Outbound CI relationships',
      items: {
        type: 'object',
        properties: {
          sys_id: {
            type: 'string',
            description: 'Sys_id of the relationship record on cmdb_rel_ci',
          },
          target: {
            type: 'json',
            description: 'Related CI as {value (sys_id), display_value, link}',
          },
          type: {
            type: 'json',
            description: 'Relationship type as {value (sys_id), display_value, link}',
          },
        },
      },
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
      properties: {
        inboundCount: { type: 'number', description: 'Number of inbound relations' },
        outboundCount: { type: 'number', description: 'Number of outbound relations' },
      },
    },
  },
}
