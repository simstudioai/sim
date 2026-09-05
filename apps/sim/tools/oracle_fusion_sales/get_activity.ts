import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  ACTIVITY_OUTPUT_PROPERTIES,
  type OracleFusionSalesGetActivityParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesGetActivityTool =
  createOracleFusionSalesTool<OracleFusionSalesGetActivityParams>({
    id: 'oracle_fusion_sales_get_activity',
    operation: 'get_activity',
    name: 'Oracle Fusion Sales Get activity',
    description: 'Get activity in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: ACTIVITY_OUTPUT_PROPERTIES,
      },
    },
  })
