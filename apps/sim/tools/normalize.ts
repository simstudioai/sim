/**
 * Normalizes a tool ID by stripping resource ID suffix (UUID/tableId).
 * Workflow tools: 'workflow_executor_<uuid>' -> 'workflow_executor'
 * Knowledge tools: 'knowledge_search_<uuid>' -> 'knowledge_search'
 * Table tools: 'table_query_rows_<tableId>' -> 'table_query_rows'
 *
 * Pure string utility — no server dependencies, safe to import in client components.
 */
export function normalizeToolId(toolId: string): string {
  // Check the longer prefix first — `custom_block_executor_` also starts with
  // neither `workflow_executor_` nor a knowledge/table op, so ordering is safe,
  // but keep it explicit since its suffix (`custom_block_<id>`) is itself prefixed.
  if (
    toolId.startsWith('custom_block_executor_') &&
    toolId.length > 'custom_block_executor_'.length
  ) {
    return 'custom_block_executor'
  }

  if (toolId.startsWith('workflow_executor_') && toolId.length > 'workflow_executor_'.length) {
    return 'workflow_executor'
  }

  const knowledgeOps = ['knowledge_search', 'knowledge_upload_chunk', 'knowledge_create_document']
  for (const op of knowledgeOps) {
    if (toolId.startsWith(`${op}_`) && toolId.length > op.length + 1) {
      return op
    }
  }

  const tableOps = [
    'table_query_rows',
    'table_insert_row',
    'table_batch_insert_rows',
    'table_update_row',
    'table_update_rows_by_filter',
    'table_delete_rows_by_filter',
    'table_upsert_row',
    'table_get_row',
    'table_delete_row',
    'table_get_schema',
  ]
  for (const op of tableOps) {
    if (toolId.startsWith(`${op}_`) && toolId.length > op.length + 1) {
      return op
    }
  }

  return toolId
}
