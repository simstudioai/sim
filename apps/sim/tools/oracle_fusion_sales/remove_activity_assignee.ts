import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import type { OracleFusionSalesRemoveActivityAssigneeParams } from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesRemoveActivityAssigneeTool =
  createOracleFusionSalesTool<OracleFusionSalesRemoveActivityAssigneeParams>({
    id: 'oracle_fusion_sales_remove_activity_assignee',
    operation: 'remove_activity_assignee',
    name: 'Oracle Fusion Sales Remove activity assignee',
    description:
      'Remove activity assignee in Oracle Fusion Sales. Oracle returns no response body.',
    outputs: {
      deleted: { type: 'boolean', description: 'Oracle completed the delete request' },
    },
  })
