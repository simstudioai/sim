import {
  body,
  contentId,
  credentials,
  internalExecution,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_UPDATE_CONTENT_ITEM_OUTPUTS,
  type UpdateContentItemParams,
  type UpdateContentItemResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningUpdateContentItemTool: InternalToolConfig<
  UpdateContentItemParams,
  UpdateContentItemResponse
> = {
  id: 'oracle_fusion_learning_update_content_item',
  name: 'Update Content Item',
  description:
    'Update safe content metadata. Package uploads, ingestion controls, and upload authentication are not supported.',
  ...internalExecution,
  params: {
    ...credentials,
    ...contentId,
    body: {
      ...body.body,
      description:
        'Writable fields: Title, Description, ItemNumber, URL, Status, StartDate, EndDate. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learningcontentitems-contentid-patch.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_UPDATE_CONTENT_ITEM_OUTPUTS,
}
