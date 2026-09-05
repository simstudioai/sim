import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  ACTIVITY_OUTPUT_PROPERTIES,
  type OracleFusionSalesUpdateActivityParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesUpdateActivityTool =
  createOracleFusionSalesTool<OracleFusionSalesUpdateActivityParams>({
    id: 'oracle_fusion_sales_update_activity',
    operation: 'update_activity',
    name: 'Oracle Fusion Sales Update activity',
    description: 'Update activity in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: ACTIVITY_OUTPUT_PROPERTIES,
      },
    },
  })
