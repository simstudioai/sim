import { createTool } from '@/tools/google_contacts/create'
import { deleteTool } from '@/tools/google_contacts/delete'
import { getTool } from '@/tools/google_contacts/get'
import { listTool } from '@/tools/google_contacts/list'
import { searchTool } from '@/tools/google_contacts/search'
import { updateTool } from '@/tools/google_contacts/update'

export const googleContactsCreateTool = createTool
export const googleContactsDeleteTool = deleteTool
export const googleContactsGetTool = getTool
export const googleContactsListTool = listTool
export const googleContactsSearchTool = searchTool
export const googleContactsUpdateTool = updateTool
