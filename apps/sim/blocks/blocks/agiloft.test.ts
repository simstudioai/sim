/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { AgiloftBlock } from '@/blocks/blocks/agiloft'

function conditionFor(subBlockId: string) {
  const subBlock = AgiloftBlock.subBlocks.find((entry) => entry.id === subBlockId)
  expect(subBlock, `subBlock ${subBlockId} is missing`).toBeDefined()
  return subBlock?.condition
}

describe('AgiloftBlock', () => {
  /**
   * Natural Language Search runs across the whole knowledge base with no table
   * to narrow it, so pagination is the caller's only bound on the result size.
   * A condition naming only search_records hides both fields from the operation
   * that most needs them.
   */
  it('offers page and limit to natural language search, not only to search records', () => {
    for (const field of ['page', 'limit']) {
      expect(conditionFor(field)).toEqual({
        field: 'operation',
        value: ['search_records', 'nlp_search'],
      })
    }
  })

  /**
   * The NLP search route returns records, totalCount, and truncated — never a
   * limit — so advertising limit for that operation promises an output that
   * never arrives.
   */
  it('does not advertise a limit output for natural language search', () => {
    expect(AgiloftBlock.outputs.limit.condition).toEqual({
      field: 'operation',
      value: 'search_records',
    })
  })
})
