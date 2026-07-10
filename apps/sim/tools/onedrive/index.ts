import { copyTool } from '@/tools/onedrive/copy'
import { createFolderTool } from '@/tools/onedrive/create_folder'
import { createShareLinkTool } from '@/tools/onedrive/create_share_link'
import { deleteTool } from '@/tools/onedrive/delete'
import { downloadTool } from '@/tools/onedrive/download'
import { getDriveInfoTool } from '@/tools/onedrive/get_drive_info'
import { getItemTool } from '@/tools/onedrive/get_item'
import { listTool } from '@/tools/onedrive/list'
import { moveTool } from '@/tools/onedrive/move'
import { searchTool } from '@/tools/onedrive/search'
import { uploadTool } from '@/tools/onedrive/upload'

export const onedriveCopyTool = copyTool
export const onedriveCreateFolderTool = createFolderTool
export const onedriveCreateShareLinkTool = createShareLinkTool
export const onedriveDeleteTool = deleteTool
export const onedriveDownloadTool = downloadTool
export const onedriveGetDriveInfoTool = getDriveInfoTool
export const onedriveGetItemTool = getItemTool
export const onedriveListTool = listTool
export const onedriveMoveTool = moveTool
export const onedriveSearchTool = searchTool
export const onedriveUploadTool = uploadTool
