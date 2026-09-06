import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionAmendProductParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionAmendProductTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionAmendProductParams>({
    id: 'oracle_fusion_subscription_management_amend_product',
    operation: 'amend_product',
    name: 'Oracle Fusion Subscription Management Amend product',
    description:
      'Amend product using the documented Oracle action. Read the record to verify completion.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Documented Oracle action result; a submission message does not mean completion',
      },
    },
  })
