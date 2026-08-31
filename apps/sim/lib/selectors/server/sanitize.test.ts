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

  it('fails closed when protected plaintext is percent encoded', () => {
    const protectedValues = createSelectorProtectedValues()
    protectedValues.add('selector secret/canary')

    for (const value of [
      'selector%20secret%2Fcanary',
      'selector%2520secret%252Fcanary',
      'prefix-selector%20secret%2Fcanary-suffix',
    ]) {
      expect(() =>
        sanitizeSelectorResult(
          { kind: 'list', items: [{ id: 'safe-id', label: value }] },
          protectedValues
        )
      ).toThrow(SelectorOptionsUnavailableError)
    }
  })

  it('rejects malformed encoded output without treating literal percentages as encoding', () => {
    const protectedValues = createSelectorProtectedValues()
    protectedValues.add('secret')

    expect(() =>
      sanitizeSelectorResult(
        { kind: 'list', items: [{ id: 'safe-id', label: '%73ecret%ZZ' }] },
        protectedValues
      )
    ).toThrow(SelectorOptionsUnavailableError)
    expect(
      sanitizeSelectorResult(
        { kind: 'list', items: [{ id: 'safe-id', label: 'Save 50% today' }] },
        protectedValues
      )
    ).toEqual({ kind: 'list', items: [{ id: 'safe-id', label: 'Save 50% today' }] })
  })

  it('distinguishes short identifiers from raw secrets when checking substrings', () => {
    const referenceValues = createSelectorProtectedValues()
    referenceValues.add('a', 'reference')

    expect(
      sanitizeSelectorResult(
        { kind: 'list', items: [{ id: 'INBOX', label: 'Drafts' }] },
        referenceValues
      )
    ).toEqual({ kind: 'list', items: [{ id: 'INBOX', label: 'Drafts' }] })
    expect(() =>
      sanitizeSelectorResult(
        { kind: 'list', items: [{ id: 'a', label: 'Exact identifier' }] },
        referenceValues
      )
    ).toThrow(SelectorOptionsUnavailableError)

    const secretValues = createSelectorProtectedValues()
    secretValues.add('a', 'secret')
    expect(() =>
      sanitizeSelectorResult(
        { kind: 'list', items: [{ id: 'INBOX', label: 'Drafts' }] },
        secretValues
      )
    ).toThrow(SelectorOptionsUnavailableError)
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

  it('rejects an allowed detail ID that embeds another protected value', () => {
    const protectedValues = createSelectorProtectedValues()
    protectedValues.add('resolved-another-secret-id')
    protectedValues.add('another-secret')

    expect(() =>
      sanitizeSelectorResult(
        {
          kind: 'detail',
          item: {
            id: 'resolved-another-secret-id',
            label: 'Resolved item',
          },
        },
        protectedValues,
        { allowedDetailExactProtectedValue: 'resolved-another-secret-id' }
      )
    ).toThrow(SelectorOptionsUnavailableError)
  })

  it('rejects protected plaintext in metadata keys without applying the detail exemption', () => {
    const protectedValues = createSelectorProtectedValues()
    protectedValues.add('resolved-id')

    expect(() =>
      sanitizeSelectorResult(
        {
          kind: 'detail',
          item: {
            id: 'resolved-id',
            label: 'resolved-id',
            meta: { 'prefix-resolved-id-suffix': null },
          },
        },
        protectedValues,
        { allowedDetailExactProtectedValue: 'resolved-id' }
      )
    ).toThrow(SelectorOptionsUnavailableError)
  })

  it('rejects protected numeric metadata without applying the detail exemption', () => {
    const protectedValues = createSelectorProtectedValues()
    protectedValues.add('1234')

    expect(() =>
      sanitizeSelectorResult(
        {
          kind: 'detail',
          item: { id: '1234', label: '1234', meta: { resourceId: 1234 } },
        },
        protectedValues,
        { allowedDetailExactProtectedValue: '1234' }
      )
    ).toThrow(SelectorOptionsUnavailableError)
  })

  it('preserves allowed metadata keys that shadow object prototype properties', () => {
    const meta = Object.create(null) as Record<string, null>
    meta.__proto__ = null

    const result = sanitizeSelectorResult(
      {
        kind: 'list',
        items: [{ id: 'resource-1', label: 'Resource one', meta }],
      },
      createSelectorProtectedValues()
    )

    expect(result.kind).toBe('list')
    if (result.kind !== 'list') throw new Error('Expected list selector result')
    expect(Object.hasOwn(result.items[0].meta ?? {}, '__proto__')).toBe(true)
    expect(result.items[0].meta?.__proto__).toBeNull()
    expect(JSON.stringify(result.items[0].meta)).toBe('{"__proto__":null}')
  })

  it('rejects metadata strings larger than the response contract permits', () => {
    expect(() =>
      sanitizeSelectorResult(
        {
          kind: 'list',
          items: [
            {
              id: 'resource-1',
              label: 'Resource one',
              meta: { description: 'x'.repeat(16 * 1024 + 1) },
            },
          ],
        },
        createSelectorProtectedValues()
      )
    ).toThrow(SelectorOptionsUnavailableError)
  })
})
