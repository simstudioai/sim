import {
  credentials,
  effectiveDate,
  internalExecution,
  limit,
  offset,
  search,
} from '@/tools/oracle_fusion_learning/common'
import {
  type ListSelfPacedItemsParams,
  type ListSelfPacedItemsResponse,
  ORACLE_FUSION_LEARNING_LIST_SELF_PACED_ITEMS_OUTPUTS,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningListSelfPacedItemsTool: InternalToolConfig<
  ListSelfPacedItemsParams,
  ListSelfPacedItemsResponse
> = {
  id: 'oracle_fusion_learning_list_self_paced_items',
  name: 'List Self Paced Items',
  description: 'List or search self-paced catalog items in an enabled Fusion Learning tenant.',
  ...internalExecution,
  params: {
    ...credentials,
    ...limit,
    ...offset,
    ...search,
    ...effectiveDate,
  },
  outputs: ORACLE_FUSION_LEARNING_LIST_SELF_PACED_ITEMS_OUTPUTS,
}
