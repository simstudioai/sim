/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
import { appendSelectorOptions } from '@/lib/selectors/server/option-budget'
import { listSelectorResult } from '@/lib/selectors/server/types'

describe('selector option budget', () => {
  it('appends only the entries that fit', () => {
    const target = [1, 2]

    expect(appendSelectorOptions(target, [3, 4, 5], 4)).toEqual({
      full: true,
      overflow: true,
    })
    expect(target).toEqual([1, 2, 3, 4])
  })

  it('defensively returns a bounded partial list with diagnostics', () => {
    const result = listSelectorResult(
      Array.from({ length: MAX_SELECTOR_OPTIONS + 1 }, (_, index) => ({
        id: String(index),
        label: `Option ${index}`,
      }))
    )

    expect(result).toMatchObject({
      kind: 'list',
      diagnostics: {
        truncated: { reason: 'provider-cap', limit: MAX_SELECTOR_OPTIONS },
      },
    })
    expect(result.kind === 'list' ? result.items : []).toHaveLength(MAX_SELECTOR_OPTIONS)
  })
})
