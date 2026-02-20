import { addRecordTool } from '@/tools/algolia/add_record'
import { batchOperationsTool } from '@/tools/algolia/batch_operations'
import { browseRecordsTool } from '@/tools/algolia/browse_records'
import { clearRecordsTool } from '@/tools/algolia/clear_records'
import { copyMoveIndexTool } from '@/tools/algolia/copy_move_index'
import { deleteByFilterTool } from '@/tools/algolia/delete_by_filter'
import { deleteIndexTool } from '@/tools/algolia/delete_index'
import { deleteRecordTool } from '@/tools/algolia/delete_record'
import { getRecordTool } from '@/tools/algolia/get_record'
import { getRecordsTool } from '@/tools/algolia/get_records'
import { getSettingsTool } from '@/tools/algolia/get_settings'
import { listIndicesTool } from '@/tools/algolia/list_indices'
import { partialUpdateRecordTool } from '@/tools/algolia/partial_update_record'
import { searchTool } from '@/tools/algolia/search'
import { updateSettingsTool } from '@/tools/algolia/update_settings'

export const algoliaSearchTool = searchTool
export const algoliaAddRecordTool = addRecordTool
export const algoliaGetRecordTool = getRecordTool
export const algoliaGetRecordsTool = getRecordsTool
export const algoliaDeleteRecordTool = deleteRecordTool
export const algoliaPartialUpdateRecordTool = partialUpdateRecordTool
export const algoliaBrowseRecordsTool = browseRecordsTool
export const algoliaBatchOperationsTool = batchOperationsTool
export const algoliaListIndicesTool = listIndicesTool
export const algoliaGetSettingsTool = getSettingsTool
export const algoliaUpdateSettingsTool = updateSettingsTool
export const algoliaDeleteIndexTool = deleteIndexTool
export const algoliaCopyMoveIndexTool = copyMoveIndexTool
export const algoliaClearRecordsTool = clearRecordsTool
export const algoliaDeleteByFilterTool = deleteByFilterTool
