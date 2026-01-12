import { deleteTool } from './delete'
import { getTool } from './get'
import { introspectTool } from './introspect'
import { putTool } from './put'
import { queryTool } from './query'
import { scanTool } from './scan'
import { updateTool } from './update'

export const dynamodbDeleteTool = deleteTool
export const dynamodbGetTool = getTool
export const dynamodbIntrospectTool = introspectTool
export const dynamodbPutTool = putTool
export const dynamodbQueryTool = queryTool
export const dynamodbScanTool = scanTool
export const dynamodbUpdateTool = updateTool
