import { createOracleFusionSalesTool } from '@/tools/oracle_fusion_sales/shared'
import {
  CONTACT_OUTPUT_PROPERTIES,
  type OracleFusionSalesUpdateContactParams,
} from '@/tools/oracle_fusion_sales/types'

export const oracleFusionSalesUpdateContactTool =
  createOracleFusionSalesTool<OracleFusionSalesUpdateContactParams>({
    id: 'oracle_fusion_sales_update_contact',
    operation: 'update_contact',
    name: 'Oracle Fusion Sales Update contact',
    description: 'Update contact in Oracle Fusion Sales using documented CRM REST fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented Oracle Sales record fields',
        properties: CONTACT_OUTPUT_PROPERTIES,
      },
    },
  })
