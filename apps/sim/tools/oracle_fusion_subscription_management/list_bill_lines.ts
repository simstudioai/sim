import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionListBillLinesParams } from '@/tools/oracle_fusion_subscription_management/types'
import {
  BILL_LINE_OUTPUT_PROPERTIES,
  PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionListBillLinesTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionListBillLinesParams>({
    id: 'oracle_fusion_subscription_management_list_bill_lines',
    operation: 'list_bill_lines',
    name: 'Oracle Fusion Subscription Management List bill lines',
    description:
      'List bill lines in one bounded Oracle Fusion page. Use documented filters and pagination.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of subscription records',
        items: { type: 'object', properties: BILL_LINE_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
