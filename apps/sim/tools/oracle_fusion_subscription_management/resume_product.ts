import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionResumeProductParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionResumeProductTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionResumeProductParams>({
    id: 'oracle_fusion_subscription_management_resume_product',
    operation: 'resume_product',
    name: 'Oracle Fusion Subscription Management Resume product',
    description:
      'Resume product using the documented Oracle action. Read the record to verify completion.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Documented Oracle action result; a submission message does not mean completion',
      },
    },
  })
