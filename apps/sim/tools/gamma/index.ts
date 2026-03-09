import { checkStatusTool } from '@/tools/gamma/check_status'
import { generateTool } from '@/tools/gamma/generate'
import { generateFromTemplateTool } from '@/tools/gamma/generate_from_template'
import { listFoldersTool } from '@/tools/gamma/list_folders'
import { listThemesTool } from '@/tools/gamma/list_themes'

export const gammaGenerateTool = generateTool
export const gammaGenerateFromTemplateTool = generateFromTemplateTool
export const gammaCheckStatusTool = checkStatusTool
export const gammaListThemesTool = listThemesTool
export const gammaListFoldersTool = listFoldersTool
