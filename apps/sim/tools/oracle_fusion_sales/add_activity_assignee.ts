import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  ASSIGNEE_OUTPUT_PROPERTIES,
  type OracleFusionSalesAddActivityAssigneeParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesAddActivityAssigneeTool =
  createOracleFusionSalesTool<OracleFusionSalesAddActivityAssigneeParams>({
    id: 'oracle_fusion_sales_add_activity_assignee',
    operation: 'add_activity_assignee',
    name: 'Oracle Fusion Sales Add activity assignee',
    description: 'Add activity assignee in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: ASSIGNEE_OUTPUT_PROPERTIES,
      },
    },
  })
