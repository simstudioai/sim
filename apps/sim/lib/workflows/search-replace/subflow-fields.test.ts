/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS,
  workflowSearchSubflowFieldMatchesExpected,
} from '@/lib/workflows/search-replace/subflow-fields'

describe('workflowSearchSubflowFieldMatchesExpected', () => {
  it('detects stale loop and parallel field values before replace apply', () => {
    expect(
      workflowSearchSubflowFieldMatchesExpected(
        { type: 'loop', data: { loopType: 'for', count: 5 } },
        WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.iterations,
        '5'
      )
    ).toBe(true)
    expect(
      workflowSearchSubflowFieldMatchesExpected(
        { type: 'loop', data: { loopType: 'for', count: 10 } },
        WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.iterations,
        '5'
      )
    ).toBe(false)
    expect(
      workflowSearchSubflowFieldMatchesExpected(
        { type: 'parallel', data: { parallelType: 'collection', collection: '{{items}}' } },
        WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS.items,
        '{{items}}'
      )
    ).toBe(true)
  })
})
