import { createTool } from '@/tools/google_docs/create'
import { insertImageTool } from '@/tools/google_docs/insert-image'
import { insertPageBreakTool } from '@/tools/google_docs/insert-page-break'
import { insertTableTool } from '@/tools/google_docs/insert-table'
import { insertTextTool } from '@/tools/google_docs/insert-text'
import { readTool } from '@/tools/google_docs/read'
import { replaceTextTool } from '@/tools/google_docs/replace-text'
import { updateTextStyleTool } from '@/tools/google_docs/update-text-style'
import { writeTool } from '@/tools/google_docs/write'

export const googleDocsReadTool = readTool
export const googleDocsWriteTool = writeTool
export const googleDocsCreateTool = createTool
export const googleDocsInsertTextTool = insertTextTool
export const googleDocsReplaceTextTool = replaceTextTool
export const googleDocsInsertTableTool = insertTableTool
export const googleDocsInsertImageTool = insertImageTool
export const googleDocsInsertPageBreakTool = insertPageBreakTool
export const googleDocsUpdateTextStyleTool = updateTextStyleTool

export * from './types'
