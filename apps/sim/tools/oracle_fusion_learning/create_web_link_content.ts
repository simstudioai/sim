import {
  body,
  credentials,
  internalExecution,
} from '@/tools/oracle_fusion_learning/common'
import {
  type CreateWebLinkContentParams,
  type CreateWebLinkContentResponse,
  ORACLE_FUSION_LEARNING_CREATE_WEB_LINK_CONTENT_OUTPUTS,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningCreateWebLinkContentTool: InternalToolConfig<
  CreateWebLinkContentParams,
  CreateWebLinkContentResponse
> = {
  id: 'oracle_fusion_learning_create_web_link_content',
  name: 'Create Web Link Content',
  description:
    'Create URL content with ORA_AUTO tracking. This does not upload a package or publish a catalog item.',
  ...internalExecution,
  params: {
    ...credentials,
    body: {
      ...body.body,
      description:
        'Required: Title, URL. Writable fields: Title, Description, ItemNumber, URL, Status, StartDate, EndDate. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learningcontentitems-post.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_CREATE_WEB_LINK_CONTENT_OUTPUTS,
}
