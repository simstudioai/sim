import { functionExecuteTool } from '@/tools/function'
import { httpRequestTool } from '@/tools/http'
import {
  tableBatchInsertRowsTool,
  tableDeleteRowsByFilterTool,
  tableDeleteRowTool,
  tableGetRowTool,
  tableGetSchemaTool,
  tableInsertRowTool,
  tableQueryRowsV2Tool,
  tableUpdateRowsByFilterTool,
  tableUpdateRowTool,
  tableUpsertRowTool,
} from '@/tools/table'
import type { ToolConfig } from '@/tools/types'

/**
 * Dev-only minimal tool registry. Swapped in for `@/tools/registry` via a
 * Turbopack/webpack resolve-alias when `SIM_DEV_MINIMAL_REGISTRY=1` (see
 * next.config.ts) so the local dev server never compiles the full ~247-tool
 * graph (~2,074 modules) that the shared workspace layout otherwise drags into
 * every route. Only these tools execute in minimal mode; unset the flag for the
 * full set. NEVER aliased in production.
 */
export const tools: Record<string, ToolConfig> = {
  http_request: httpRequestTool,
  function_execute: functionExecuteTool,
  // Table v2 block operations (so the v2 Table block is runnable in minimal mode).
  table_insert_row: tableInsertRowTool,
  table_batch_insert_rows: tableBatchInsertRowsTool,
  table_upsert_row: tableUpsertRowTool,
  table_update_row: tableUpdateRowTool,
  table_update_rows_by_filter: tableUpdateRowsByFilterTool,
  table_delete_row: tableDeleteRowTool,
  table_delete_rows_by_filter: tableDeleteRowsByFilterTool,
  table_query_rows_v2: tableQueryRowsV2Tool,
  table_get_row: tableGetRowTool,
  table_get_schema: tableGetSchemaTool,
}
