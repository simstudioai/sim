import { deleteTool } from './delete'
import { executeTool } from './execute'
import { insertTool } from './insert'
import { queryTool } from './query'
import { updateTool } from './update'

export const mongodbDeleteTool = deleteTool
export const mongodbExecuteTool = executeTool
export const mongodbInsertTool = insertTool
export const mongodbQueryTool = queryTool
export const mongodbUpdateTool = updateTool

export * from './types'
