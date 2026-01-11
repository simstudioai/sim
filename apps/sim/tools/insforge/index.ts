import { completionTool } from '@/tools/insforge/completion'
import { deleteTool } from '@/tools/insforge/delete'
import { getRowTool } from '@/tools/insforge/get_row'
import { imageGenerationTool } from '@/tools/insforge/image_generation'
import { insertTool } from '@/tools/insforge/insert'
import { invokeTool } from '@/tools/insforge/invoke'
import { queryTool } from '@/tools/insforge/query'
import { storageDeleteTool } from '@/tools/insforge/storage_delete'
import { storageDownloadTool } from '@/tools/insforge/storage_download'
import { storageListTool } from '@/tools/insforge/storage_list'
import { storageUploadTool } from '@/tools/insforge/storage_upload'
import { updateTool } from '@/tools/insforge/update'
import { upsertTool } from '@/tools/insforge/upsert'
import { visionTool } from '@/tools/insforge/vision'

export const insforgeQueryTool = queryTool
export const insforgeGetRowTool = getRowTool
export const insforgeInsertTool = insertTool
export const insforgeUpdateTool = updateTool
export const insforgeDeleteTool = deleteTool
export const insforgeUpsertTool = upsertTool
export const insforgeStorageUploadTool = storageUploadTool
export const insforgeStorageDownloadTool = storageDownloadTool
export const insforgeStorageListTool = storageListTool
export const insforgeStorageDeleteTool = storageDeleteTool
export const insforgeInvokeTool = invokeTool
export const insforgeCompletionTool = completionTool
export const insforgeVisionTool = visionTool
export const insforgeImageGenerationTool = imageGenerationTool
