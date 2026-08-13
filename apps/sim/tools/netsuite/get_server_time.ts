import type { NetSuiteResponse, NetSuiteSystemParams } from '@/tools/netsuite/types'
import { executeNetSuiteRequest, netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteGetServerTimeTool: ToolConfig<NetSuiteSystemParams, NetSuiteResponse> = {
  id: 'netsuite_get_server_time',
  name: 'NetSuite Get Server Time',
  description: 'Retrieve the current UTC time from the NetSuite server.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
  },
  request: { url: () => '', method: 'POST', headers: () => ({}) },
  directExecution: (params, signal) =>
    executeNetSuiteRequest(
      params,
      () => ({
        method: 'GET',
        path: '/services/rest/system/v1/serverTime',
        success: { status: 200, body: 'object', validator: 'server-time' },
      }),
      signal
    ),
  outputs: {
    status: { type: 'number', description: 'HTTP status returned by NetSuite' },
    data: {
      type: 'json',
      description: 'NetSuite server time response',
      nullable: true,
      properties: {
        serverTime: { type: 'string', description: 'Current NetSuite server time in UTC' },
      },
    },
  },
}
