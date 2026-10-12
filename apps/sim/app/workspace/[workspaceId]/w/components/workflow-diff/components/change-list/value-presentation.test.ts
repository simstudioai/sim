import { describe, expect, it } from 'vitest'
import { diffOrderedRows } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/ordered-row-diff'
import { getStructuredValuePresentation } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/value-presentation'
import type { SubBlockConfig } from '@/blocks/types'

describe('structured workflow value presentation', () => {
  it.each(['dropdown', 'combobox', 'checkbox-list'] as const)(
    'resolves %s options from each snapshot without losing stored identity',
    (type) => {
      const config: SubBlockConfig = {
        id: 'selection',
        type,
        options: ({ values } = { values: {} }) =>
          values.catalog === 'original'
            ? [
                { id: 'first', label: 'Original option' },
                { id: 'second', label: 'Original option' },
              ]
            : [{ id: 'first', label: 'Updated option' }],
      }
      const value =
        type === 'checkbox-list' ? { first: true } : ['first', 'second', 'first', 'missing']
      const original = getStructuredValuePresentation(config, 'selection', value, {
        catalog: 'original',
      })!
      const updated = getStructuredValuePresentation(config, 'selection', value, {
        catalog: 'updated',
      })!
      expect(original.rows[0].cells).toEqual(
        type === 'checkbox-list'
          ? { Option: 'Original option', Selected: true }
          : { Selection: 'Original option', Identifier: 'first' }
      )
      expect(updated.rows[0].cells).toEqual(
        type === 'checkbox-list'
          ? { Option: 'Updated option', Selected: true }
          : { Selection: 'Updated option' }
      )
      expect(original.rows.map(({ key }) => key)).toEqual(updated.rows.map(({ key }) => key))
      if (type !== 'checkbox-list') {
        expect(original.rows.map(({ cells }) => cells.Selection)).toEqual([
          'Original option',
          'Original option',
          'Original option',
          'missing',
        ])
        expect(updated.rows.map(({ cells }) => cells.Selection)).toEqual([
          'Updated option',
          'second',
          'Updated option',
          'missing',
        ])
      }
    }
  )

  it.each([false, true])(
    'preserves header order and ignores editor metadata (encoded: %s)',
    (encoded) => {
      const stored = (value: unknown) => (encoded ? JSON.stringify(value) : value)
      const config = { id: 'headers', type: 'table' as const, columns: ['Key', 'Value'] }
      const source = [
        { id: 'first', cells: { Key: 'X-Mode', Value: 'first' } },
        { id: 'second', cells: { Key: 'X-Mode', Value: 'last' } },
        { id: 'blank', cells: { Key: '', Value: '' } },
        { id: 'empty-value', cells: { Key: 'X-Empty', Value: '' } },
      ]
      const result = getStructuredValuePresentation(config, 'headers', stored(source))!
      expect(result.columns).toEqual(['Key', 'Value'])
      expect(result.rows.map((row) => row.cells)).toEqual([
        { Key: 'X-Mode', Value: 'first' },
        { Key: 'X-Mode', Value: 'last' },
        { Key: 'X-Empty', Value: '' },
      ])
      const recreated = source.map((row, index) => ({ ...row, id: `recreated-${index}` }))
      expect(
        getStructuredValuePresentation(config, 'headers', stored(recreated))?.rows.map(
          (row) => row.key
        )
      ).toEqual(result.rows.map((row) => row.key))
      expect(
        getStructuredValuePresentation(config, 'headers', stored([...source].reverse()))?.rows.map(
          (row) => row.key
        )
      ).not.toEqual(result.rows.map((row) => row.key))
    }
  )

  it('keeps surviving router rows unchanged when a preceding route is removed', () => {
    const config = { id: 'routes', type: 'router-input' as const }
    const source = [
      { id: 'a', value: 'first' },
      { id: 'b', value: 'second' },
      { id: 'c', value: 'third' },
    ]
    const before = getStructuredValuePresentation(config, 'routes', source)!
    const after = getStructuredValuePresentation(config, 'routes', source.slice(1))!
    expect(diffOrderedRows(before.rows, after.rows).map(({ kind }) => kind)).toEqual([
      'removed',
      'context',
      'context',
    ])
    const changed = getStructuredValuePresentation(config, 'routes', [
      { ...source[1], value: 'edited' },
      source[2],
    ])!
    expect(diffOrderedRows(after.rows, changed.rows).map(({ kind }) => kind)).toEqual([
      'removed',
      'added',
      'context',
    ])
  })

  it('keeps secret-only edits distinct before the renderer masks cells', () => {
    const config = { id: 'headers', type: 'table' as const, columns: ['Key', 'Value'] }
    const row = (value: string) => [{ cells: { Key: 'Authorization', Value: value } }]
    const before = getStructuredValuePresentation(config, 'headers', row('Bearer before'))!
    const after = getStructuredValuePresentation(config, 'headers', row('Bearer after'))!
    expect(before.rows[0].key).not.toBe(after.rows[0].key)
    expect(before.rows[0].cells.Value).toBe('Bearer before')
    expect(after.rows[0].cells.Value).toBe('Bearer after')
  })

  it('presents encoded branches by their roles without discarding unknown branch data', () => {
    const result = getStructuredValuePresentation(
      { id: 'conditions', type: 'condition-input' },
      'conditions',
      '[{"id":"first","value":"true","metadata":{"owner":null}},{"id":"last","value":""}]'
    )!
    expect(result.rows.map((row) => row.cells.Branch)).toEqual(['if', 'else'])
    expect(result.rows.map((row) => row.cells.Condition)).toEqual(['true', ''])
    expect(result.rows[0].cells.Details).toEqual({ metadata: { owner: null } })
    expect(result.rows[0].key).toContain('first')
  })

  it('keeps repeated message roles, empty content and conversation order', () => {
    const result = getStructuredValuePresentation(
      { id: 'messages', type: 'messages-input' },
      'messages',
      [
        { role: 'user', content: 'First' },
        { role: 'user', content: '' },
        { role: 'assistant', content: 'Last' },
      ]
    )!
    expect(result.rows.map((row) => row.cells)).toEqual([
      { Role: 'user', Content: 'First' },
      { Role: 'user', Content: '' },
      { Role: 'assistant', Content: 'Last' },
    ])
  })

  it('keeps complete tool execution configuration and unknown own JSON keys', () => {
    const tool = JSON.parse(
      '{"type":"custom","title":"Inspect","toolId":"fixture","operation":"run","usageControl":"force","usageControlExpression":"true","params":{"token":"secret"},"code":"return 1","schema":{"__proto__":{"answer":1}},"future":{"enabled":false},"isExpanded":true}'
    )
    const result = getStructuredValuePresentation({ id: 'tools', type: 'tool-input' }, 'tools', [
      tool,
    ])!
    const { isExpanded, title, ...configuration } = tool
    expect(result.rows[0].cells.Tool).toBe('Inspect')
    expect(result.rows[0].cells.Configuration).toEqual(configuration)
    expect(result.rows[0].key).toContain('__proto__')
    expect(result.rows[0].key).not.toContain('isExpanded')
  })

  it('preserves typed maps independently of key order and retains malformed input', () => {
    const config = { id: 'inputMapping', type: 'workflow-input-mapper' as const }
    const result = getStructuredValuePresentation(
      config,
      'inputMapping',
      '{"enabled":false,"count":0,"nested":{"owner":null}}'
    )!
    expect(result.rows.map((row) => row.cells)).toEqual([
      { Field: 'count', Value: 0 },
      { Field: 'enabled', Value: false },
      { Field: 'nested', Value: { owner: null } },
    ])
    const reordered = getStructuredValuePresentation(config, 'inputMapping', {
      nested: { owner: null },
      count: 0,
      enabled: false,
    })!
    expect(reordered.rows).toEqual(result.rows)
    const malformed = getStructuredValuePresentation(config, 'inputMapping', '{"enabled":')!
    expect(malformed.rows.map((row) => row.cells)).toEqual([{ Value: '{"enabled":' }])
  })

  it('retains encoding changes when parsed rows have identical values', () => {
    const config = { id: 'mapping', type: 'input-mapping' as const }
    const compact = getStructuredValuePresentation(config, 'mapping', '{"x":1}')!
    const spaced = getStructuredValuePresentation(config, 'mapping', '{ "x": 1 }')!
    const object = getStructuredValuePresentation(config, 'mapping', { x: 1 })!
    expect(compact.rows).toEqual(spaced.rows)
    expect(compact.rows).toEqual(object.rows)
    expect(compact.sourceKey).not.toBe(spaced.sourceKey)
    expect(compact.encoding).toBe('json-text')
    expect(object.encoding).toBe('structured')
  })

  it('distinguishes missing domain values from explicit empty lists and objects', () => {
    const messages = { id: 'messages', type: 'messages-input' as const }
    const mapping = { id: 'mapping', type: 'input-mapping' as const }
    expect(getStructuredValuePresentation(messages, 'messages', null)?.rows).toEqual([])
    expect(
      getStructuredValuePresentation(messages, 'messages', [])?.rows.map((row) => row.cells)
    ).toEqual([{ Value: [] }])
    expect(
      getStructuredValuePresentation(mapping, 'mapping', {})?.rows.map((row) => row.cells)
    ).toEqual([{ Value: {} }])
  })
})
