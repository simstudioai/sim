import { deleteTool } from '@/tools/supabase/delete'
import { getRowTool } from '@/tools/supabase/get_row'
import { insertTool } from '@/tools/supabase/insert'
import { queryTool } from '@/tools/supabase/query'
import { updateTool } from '@/tools/supabase/update'

export const supabaseQueryTool = queryTool
export const supabaseInsertTool = insertTool
export const supabaseGetRowTool = getRowTool
export const supabaseUpdateTool = updateTool
export const supabaseDeleteTool = deleteTool
