import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  ACTIVITY_OUTPUT_PROPERTIES,
  type OracleFusionSalesListActivitiesParams,
  PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesListActivitiesTool =
  createOracleFusionSalesTool<OracleFusionSalesListActivitiesParams>({
    id: 'oracle_fusion_sales_list_activities',
    operation: 'list_activities',
    name: 'Oracle Fusion Sales List activities',
    description:
      'List one bounded page of activities from Oracle Fusion Sales. Use q, finder, and pagination to control the result.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of Oracle Sales records',
        items: { type: 'object', properties: ACTIVITY_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
