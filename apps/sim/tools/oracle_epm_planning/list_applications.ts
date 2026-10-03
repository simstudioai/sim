import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningListApplicationsParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import { oracleEpmPlanningAuthParamFields } from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_applications.html */
export const oracleEpmPlanningListApplicationsTool: InternalToolConfig<
  OracleEpmPlanningListApplicationsParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_list_applications',
  name: 'Oracle EPM Planning List Applications',
  description: 'List applications available to the service administrator.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    applications: {
      type: 'array',
      description: 'Available applications',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Application name',
          },
          type: {
            type: 'string',
            description: 'type',
            optional: true,
          },
          appType: {
            type: 'string',
            description: 'appType',
            optional: true,
          },
          appStorage: {
            type: 'string',
            description: 'appStorage',
            optional: true,
          },
          unicode: {
            type: 'boolean',
            description: 'unicode',
            optional: true,
          },
          adminMode: {
            type: 'boolean',
            description: 'adminMode',
            optional: true,
          },
          hybrid: {
            type: 'boolean',
            description: 'hybrid',
            optional: true,
          },
        },
      },
    },
  },
}
