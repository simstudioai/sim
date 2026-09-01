import { deleteTool } from '@/tools/mssql/delete'
import { executeTool } from '@/tools/mssql/execute'
import { insertTool } from '@/tools/mssql/insert'
import { introspectTool } from '@/tools/mssql/introspect'
import { queryTool } from '@/tools/mssql/query'
import { updateTool } from '@/tools/mssql/update'

export const mssqlDeleteTool = deleteTool
export const mssqlExecuteTool = executeTool
export const mssqlInsertTool = insertTool
export const mssqlIntrospectTool = introspectTool
export const mssqlQueryTool = queryTool
export const mssqlUpdateTool = updateTool
