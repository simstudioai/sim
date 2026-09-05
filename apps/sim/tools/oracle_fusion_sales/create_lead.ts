import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  LEAD_OUTPUT_PROPERTIES,
  type OracleFusionSalesCreateLeadParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesCreateLeadTool =
  createOracleFusionSalesTool<OracleFusionSalesCreateLeadParams>({
    id: 'oracle_fusion_sales_create_lead',
    operation: 'create_lead',
    name: 'Oracle Fusion Sales Create lead',
    description: 'Create lead in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: LEAD_OUTPUT_PROPERTIES,
      },
    },
  })
