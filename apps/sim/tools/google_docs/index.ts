import { createTool } from '@/tools/google_docs/create'
import { createNamedRangeTool } from '@/tools/google_docs/create-named-range'
import { createParagraphBulletsTool } from '@/tools/google_docs/create-paragraph-bullets'
import { deleteContentRangeTool } from '@/tools/google_docs/delete-content-range'
import { deleteNamedRangeTool } from '@/tools/google_docs/delete-named-range'
import { deleteParagraphBulletsTool } from '@/tools/google_docs/delete-paragraph-bullets'
import { insertImageTool } from '@/tools/google_docs/insert-image'
import { insertPageBreakTool } from '@/tools/google_docs/insert-page-break'
import { insertTableTool } from '@/tools/google_docs/insert-table'
import { insertTextTool } from '@/tools/google_docs/insert-text'
import { readTool } from '@/tools/google_docs/read'
import { replaceTextTool } from '@/tools/google_docs/replace-text'
import { updateParagraphStyleTool } from '@/tools/google_docs/update-paragraph-style'
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
export const googleDocsDeleteContentRangeTool = deleteContentRangeTool
export const googleDocsUpdateParagraphStyleTool = updateParagraphStyleTool
export const googleDocsCreateParagraphBulletsTool = createParagraphBulletsTool
export const googleDocsDeleteParagraphBulletsTool = deleteParagraphBulletsTool
export const googleDocsCreateNamedRangeTool = createNamedRangeTool
export const googleDocsDeleteNamedRangeTool = deleteNamedRangeTool

export * from './types'
