import { addListItemTool } from '@/tools/sharepoint/add_list_items'
import { createListTool } from '@/tools/sharepoint/create_list'
import { createPageTool } from '@/tools/sharepoint/create_page'
import { getListTool } from '@/tools/sharepoint/get_list'
import { listSitesTool } from '@/tools/sharepoint/list_sites'
import { readPageTool } from '@/tools/sharepoint/read_page'
import { updateListItemTool } from '@/tools/sharepoint/update_list'
import { uploadFileTool } from '@/tools/sharepoint/upload_file'

export const sharepointCreatePageTool = createPageTool
export const sharepointCreateListTool = createListTool
export const sharepointGetListTool = getListTool
export const sharepointListSitesTool = listSitesTool
export const sharepointReadPageTool = readPageTool
export const sharepointUpdateListItemTool = updateListItemTool
export const sharepointAddListItemTool = addListItemTool
export const sharepointUploadFileTool = uploadFileTool
