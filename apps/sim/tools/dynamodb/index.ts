import { deleteTool } from '@/tools/dynamodb/delete'
import { getTool } from '@/tools/dynamodb/get'
import { introspectTool } from '@/tools/dynamodb/introspect'
import { putTool } from '@/tools/dynamodb/put'
import { queryTool } from '@/tools/dynamodb/query'
import { scanTool } from '@/tools/dynamodb/scan'
import { updateTool } from '@/tools/dynamodb/update'

export const dynamodbDeleteTool = deleteTool
export const dynamodbGetTool = getTool
export const dynamodbIntrospectTool = introspectTool
export const dynamodbPutTool = putTool
export const dynamodbQueryTool = queryTool
export const dynamodbScanTool = scanTool
export const dynamodbUpdateTool = updateTool

export * from './types'
