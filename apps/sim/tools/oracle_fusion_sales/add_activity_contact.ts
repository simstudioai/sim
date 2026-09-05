import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  ACTIVITY_CONTACT_OUTPUT_PROPERTIES,
  type OracleFusionSalesAddActivityContactParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesAddActivityContactTool =
  createOracleFusionSalesTool<OracleFusionSalesAddActivityContactParams>({
    id: 'oracle_fusion_sales_add_activity_contact',
    operation: 'add_activity_contact',
    name: 'Oracle Fusion Sales Add activity contact',
    description: 'Add activity contact in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: ACTIVITY_CONTACT_OUTPUT_PROPERTIES,
      },
    },
  })
