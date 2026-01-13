import { deleteTool } from './delete'
import { executeTool } from './execute'
import { insertTool } from './insert'
import { introspectTool } from './introspect'
import { queryTool } from './query'
import { updateTool } from './update'

export const postgresDeleteTool = deleteTool
export const postgresExecuteTool = executeTool
export const postgresInsertTool = insertTool
export const postgresIntrospectTool = introspectTool
export const postgresQueryTool = queryTool
export const postgresUpdateTool = updateTool
