import type { NetSuiteResponse, NetSuiteSystemParams } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const netsuiteGetServerTimeTool: InternalToolConfig<NetSuiteSystemParams, NetSuiteResponse> =
  {
    id: 'netsuite_get_server_time',
    name: 'NetSuite Get Server Time',
    description: 'Retrieve the current UTC time from the NetSuite server.',
    version: '1.0.0',
    params: {
      ...netsuiteAuthParamFields,
    },
    operation: {
      input: createInternalToolOperationInput,
    },
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
