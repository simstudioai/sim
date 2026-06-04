import { appendDatasourceTool } from '@/tools/tinybird/append_datasource'
import { deleteDatasourceRowsTool } from '@/tools/tinybird/delete_datasource_rows'
import { eventsTool } from '@/tools/tinybird/events'
import { queryTool } from '@/tools/tinybird/query'
import { queryPipeTool } from '@/tools/tinybird/query_pipe'
import { truncateDatasourceTool } from '@/tools/tinybird/truncate_datasource'

export const tinybirdEventsTool = eventsTool
export const tinybirdQueryTool = queryTool
export const tinybirdQueryPipeTool = queryPipeTool
export const tinybirdAppendDatasourceTool = appendDatasourceTool
export const tinybirdTruncateDatasourceTool = truncateDatasourceTool
export const tinybirdDeleteDatasourceRowsTool = deleteDatasourceRowsTool
