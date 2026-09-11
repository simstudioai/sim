/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { remapToolCanonicalModes } from '@/lib/workflows/editing/tool-canonical-modes'

const first = { type: 'jira', operation: 'get_issue', params: { projectId: 'first' } }
const second = { type: 'jira', operation: 'get_issue', params: { projectId: 'second' } }

describe('remapToolCanonicalModes', () => {
  it('moves every indexed field and preserves block-level and legacy keys', () => {
    expect(
      remapToolCanonicalModes([first, second], structuredClone([second, first]), {
        '0:projectId': 'advanced',
        '0:issueKey': 'basic',
        '1:projectId': 'basic',
        model: 'advanced',
        'jira:issueKey': 'advanced',
      })
    ).toEqual({
      '1:projectId': 'advanced',
      '1:issueKey': 'basic',
      '0:projectId': 'basic',
      model: 'advanced',
      'jira:issueKey': 'advanced',
    })
  })

  it('reserves exact matches before matching an edited duplicate by callable identity', () => {
    const edited = { ...first, params: { projectId: 'edited' } }
    expect(
      remapToolCanonicalModes([first, second], [edited, first], {
        '0:projectId': 'basic',
        '1:projectId': 'advanced',
      })
    ).toEqual({ '1:projectId': 'basic', '0:projectId': 'advanced' })
  })

  it('drops removed and stale indexes so replacements do not inherit settings', () => {
    expect(
      remapToolCanonicalModes([first], [{ type: 'slack' }], {
        '0:projectId': 'advanced',
        '9:channel': 'basic',
        model: 'basic',
      })
    ).toEqual({ model: 'basic' })
  })

  it('clears indexed modes for an empty list', () => {
    expect(
      remapToolCanonicalModes([first], [], {
        '0:projectId': 'advanced',
        model: 'basic',
      })
    ).toEqual({ model: 'basic' })
  })

  it('preserves separate modes for identical tools when the array is unchanged', () => {
    const modes = { '0:projectId': 'basic', '1:projectId': 'advanced' } as const
    expect(remapToolCanonicalModes([first, first], structuredClone([first, first]), modes)).toEqual(
      modes
    )
  })

  it('ignores visual-only changes on an unchanged duplicate list', () => {
    expect(
      remapToolCanonicalModes(
        [first, first],
        [{ ...first, isExpanded: true, title: 'Renamed' }, first],
        { '1:projectId': 'advanced' }
      )
    ).toEqual({ '1:projectId': 'advanced' })
  })

  it('rejects indistinguishable duplicates with different saved modes', () => {
    expect(() =>
      remapToolCanonicalModes([first, first], [first], {
        '0:projectId': 'basic',
        '1:projectId': 'advanced',
      })
    ).toThrow('ambiguous canonical modes')
  })

  it('permits ambiguous duplicates when their saved modes agree', () => {
    expect(
      remapToolCanonicalModes([first, first], [first], {
        '0:projectId': 'advanced',
        '1:projectId': 'advanced',
      })
    ).toEqual({ '0:projectId': 'advanced' })
  })

  it('uses an explicit field selection to resolve ambiguity', () => {
    expect(
      remapToolCanonicalModes(
        [first, first],
        [first],
        {
          '0:projectId': 'basic',
          '1:projectId': 'advanced',
        },
        new Map([[0, { projectId: 'basic' }]])
      )
    ).toEqual({ '0:projectId': 'basic' })
  })

  it('does not let one explicit selection hide a conflict in another field', () => {
    expect(() =>
      remapToolCanonicalModes(
        [first, first],
        [first],
        {
          '0:projectId': 'basic',
          '1:projectId': 'advanced',
          '1:issueKey': 'advanced',
        },
        new Map([[0, { projectId: 'basic' }]])
      )
    ).toThrow('ambiguous canonical modes')
  })

  it.each([
    [
      { type: 'custom-tool', customToolId: 'one' },
      { type: 'custom-tool', customToolId: 'two' },
    ],
    [
      { type: 'mcp', params: { serverId: 'one', toolName: 'search' } },
      { type: 'mcp', params: { serverId: 'two', toolName: 'search' } },
    ],
    [
      { type: 'mcp-server-advanced', params: { serverId: 'one' } },
      { type: 'mcp-server-advanced', params: { serverId: 'two' } },
    ],
    [
      { type: 'workflow', params: { workflowId: 'one' } },
      { type: 'workflow', params: { workflowId: 'two' } },
    ],
  ])('keeps callable and target identities distinct: %j', (a, b) => {
    expect(remapToolCanonicalModes([a, b], [b, a], { '0:field': 'advanced' })).toEqual({
      '1:field': 'advanced',
    })
  })

  it('preserves all modes when reversing the maximum API tool count', () => {
    const tools = Array.from({ length: 100 }, (_, index) => ({
      ...first,
      params: { projectId: `${index}` },
    }))
    const modes = Object.fromEntries(
      tools.map((_, index) => [`${index}:projectId`, index % 2 ? 'basic' : 'advanced'] as const)
    )
    const expected = Object.fromEntries(
      tools.map(
        (_, index) => [`${99 - index}:projectId`, index % 2 ? 'basic' : 'advanced'] as const
      )
    )
    expect(remapToolCanonicalModes(tools, [...tools].reverse(), modes)).toEqual(expected)
  })
})
