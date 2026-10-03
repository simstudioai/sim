import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  ACTIVITY_OUTPUT_PROPERTIES,
  type OracleFusionSalesCreateTaskParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesCreateTaskTool =
  createOracleFusionSalesTool<OracleFusionSalesCreateTaskParams>({
    id: 'oracle_fusion_sales_create_task',
    operation: 'create_task',
    name: 'Oracle Fusion Sales Create task',
    description: 'Create task in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: ACTIVITY_OUTPUT_PROPERTIES,
      },
    },
  })
