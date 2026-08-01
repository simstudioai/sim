/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { normalizeToolId } from '@/tools/normalize'

describe('normalizeToolId', () => {
  it('strips a resource-id suffix', () => {
    expect(normalizeToolId('table_query_rows_tbl_1a2c1741')).toBe('table_query_rows')
    expect(normalizeToolId('knowledge_search_5cc56998-3e1d-4d91')).toBe('knowledge_search')
    expect(normalizeToolId('workflow_executor_f3d81b32')).toBe('workflow_executor')
    expect(normalizeToolId('deployed_block_executor_custom_block_9')).toBe(
      'deployed_block_executor'
    )
  })

  it('leaves a bare tool id alone', () => {
    expect(normalizeToolId('table_query_rows')).toBe('table_query_rows')
    expect(normalizeToolId('gmail_send')).toBe('gmail_send')
  })

  /**
   * Regression: `table_query_rows_v2` starts with `table_query_rows_`, so the
   * resource-suffix strip turned it into the v1 tool. The executor then logged
   * the v2 id while issuing v1's `GET /rows?filter=<predicate>` — which reached
   * the legacy filter compiler and 400'd on a correctly configured v2 block.
   */
  it('does not mistake a version suffix for a resource id', () => {
    expect(normalizeToolId('table_query_rows_v2')).toBe('table_query_rows_v2')
  })

  it('still strips a resource id from a VERSIONED op', () => {
    expect(normalizeToolId('table_query_rows_v2_tbl_1a2c1741')).toBe('table_query_rows_v2')
  })

  it('is not fooled by a table id that merely starts with v', () => {
    expect(normalizeToolId('table_query_rows_v2x')).toBe('table_query_rows')
    expect(normalizeToolId('table_query_rows_version')).toBe('table_query_rows')
  })
})
