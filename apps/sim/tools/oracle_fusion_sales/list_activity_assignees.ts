import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  ASSIGNEE_OUTPUT_PROPERTIES,
  type OracleFusionSalesListActivityAssigneesParams,
  PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesListActivityAssigneesTool =
  createOracleFusionSalesTool<OracleFusionSalesListActivityAssigneesParams>({
    id: 'oracle_fusion_sales_list_activity_assignees',
    operation: 'list_activity_assignees',
    name: 'Oracle Fusion Sales List activity assignees',
    description:
      'List one bounded page of activity assignees from Oracle Fusion Sales. Use q, finder, and pagination to control the result.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of Oracle Sales records',
        items: { type: 'object', properties: ASSIGNEE_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
