/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { SelectorOptionsUnavailableError } from '@/lib/selectors/server/errors'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { sanitizeSelectorResult } from '@/lib/selectors/server/sanitize'
import type { SelectorExecutionResult } from '@/lib/selectors/types'

describe('sanitizeSelectorResult', () => {
  it('fails closed when protected plaintext appears in any response field', () => {
    const protectedValues = createSelectorProtectedValues()
    protectedValues.add('selector-secret-canary')
    const results: SelectorExecutionResult[] = [
      {
        kind: 'list',
        items: [{ id: 'selector-secret-canary', label: 'Safe label' }],
      },
      {
        kind: 'list',
        items: [{ id: 'safe-id', label: 'prefix-selector-secret-canary-suffix' }],
      },
      {
        kind: 'detail',
        item: { id: 'safe-id', label: 'Safe label', meta: { value: 'selector-secret-canary' } },
      },
      {
        kind: 'list',
        items: [{ id: 'safe-id', label: 'Safe label' }],
        nextCursor: 'cursor-selector-secret-canary',
      },
    ]

    for (const result of results) {
      expect(() => sanitizeSelectorResult(result, protectedValues)).toThrow(
        SelectorOptionsUnavailableError
      )
    }
  })

  it('returns only the normalized selector option envelope', () => {
    const result = sanitizeSelectorResult(
      {
        kind: 'list',
        items: [
          {
            id: 'resource-1',
            label: 'Resource one',
            meta: { count: 3, active: true, parentId: null },
          },
        ],
        nextCursor: 'next-page',
      },
      createSelectorProtectedValues()
    )

    expect(result).toEqual({
      kind: 'list',
      items: [
        {
          id: 'resource-1',
          label: 'Resource one',
          meta: { count: 3, active: true, parentId: null },
        },
      ],
      nextCursor: 'next-page',
    })
  })

  it('allows only exact protected detail-id repeats for later reference restoration', () => {
    const protectedValues = createSelectorProtectedValues()
    protectedValues.add('ID')

    expect(
      sanitizeSelectorResult(
        {
          kind: 'detail',
          item: { id: 'ID', label: 'ID', meta: { resourceId: 'ID' } },
        },
        protectedValues,
        { allowedDetailExactProtectedValue: 'ID' }
      )
    ).toEqual({
      kind: 'detail',
      item: { id: 'ID', label: 'ID', meta: { resourceId: 'ID' } },
    })

    const rejectedResults: SelectorExecutionResult[] = [
      {
        kind: 'detail',
        item: { id: 'ID', label: 'prefix-ID-suffix' },
      },
      {
        kind: 'detail',
        item: { id: 'ID', label: 'ID', meta: { resourceId: 'prefix-ID-suffix' } },
      },
      {
        kind: 'list',
        items: [{ id: 'ID', label: 'ID' }],
      },
      {
        kind: 'list',
        items: [{ id: 'safe-id', label: 'Safe label' }],
        nextCursor: 'ID',
      },
    ]

    for (const result of rejectedResults) {
      expect(() =>
        sanitizeSelectorResult(result, protectedValues, {
          allowedDetailExactProtectedValue: 'ID',
        })
      ).toThrow(SelectorOptionsUnavailableError)
    }

    expect(
      sanitizeSelectorResult({ kind: 'detail', item: null }, protectedValues, {
        allowedDetailExactProtectedValue: 'ID',
      })
    ).toEqual({ kind: 'detail', item: null })
  })

  it('still rejects other protected values when allowing an exact detail ID', () => {
    const protectedValues = createSelectorProtectedValues()
    protectedValues.add('resolved-id')
    protectedValues.add('another-secret')

    expect(() =>
      sanitizeSelectorResult(
        {
          kind: 'detail',
          item: {
            id: 'resolved-id',
            label: 'resolved-id',
            meta: { resourceId: 'another-secret' },
          },
        },
        protectedValues,
        { allowedDetailExactProtectedValue: 'resolved-id' }
      )
    ).toThrow(SelectorOptionsUnavailableError)
  })
})
