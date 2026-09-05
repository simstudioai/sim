import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  LEAD_OUTPUT_PROPERTIES,
  type OracleFusionSalesUpdateLeadParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesUpdateLeadTool =
  createOracleFusionSalesTool<OracleFusionSalesUpdateLeadParams>({
    id: 'oracle_fusion_sales_update_lead',
    operation: 'update_lead',
    name: 'Oracle Fusion Sales Update lead',
    description: 'Update lead in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: LEAD_OUTPUT_PROPERTIES,
      },
    },
  })
