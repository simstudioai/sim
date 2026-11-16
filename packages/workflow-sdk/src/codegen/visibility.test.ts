import type { CatalogSubBlock } from '@sim/workflow-code'
import { describe, expect, it } from 'vitest'
import {
  buildVisibilityContext,
  classifyParam,
  findGate,
  MAX_COMBINATIONS,
  type ParamVisibility,
} from './visibility'

function subBlock(
  overrides: Partial<CatalogSubBlock> & Pick<CatalogSubBlock, 'id'>
): CatalogSubBlock {
  return { type: 'short-input', valueKind: 'string', storage: 'native', ...overrides }
}

function dropdown(id: string, options: string[]): CatalogSubBlock {
  return subBlock({
    id,
    type: 'dropdown',
    options: options.map((option) => ({ id: option, label: option })),
  })
}

describe('classifyParam', () => {
  it('classifies by the pinned operation: always, never, sometimes', () => {
    const candidates = [
      dropdown('authMethod', ['oauth', 'bot_token']),
      subBlock({ id: 'text', required: true, condition: { field: 'operation', value: 'send' } }),
      subBlock({ id: 'cursor', condition: { field: 'operation', value: 'list' } }),
      subBlock({ id: 'botToken', condition: { field: 'authMethod', value: 'bot_token' } }),
    ]
    const context = buildVisibilityContext(candidates, { operation: 'send' })
    const [, text, cursor, botToken] = candidates.map((candidate) =>
      classifyParam([candidate], context)
    )
    expect(text).toMatchObject({ kind: 'always', required: true })
    expect(cursor.kind).toBe('never')
    expect(botToken).toMatchObject({ kind: 'sometimes', required: false })
    expect(botToken.when).toBe('authMethod is "bot_token"')
  })

  it('treats a field nobody enumerates as unknown, so the param is optional', () => {
    const memory = subBlock({
      id: 'conversationId',
      required: true,
      condition: { field: 'model', value: ['gpt-5.5'] },
    })
    const context = buildVisibilityContext([memory], {})
    expect(classifyParam([memory], context)).toMatchObject({
      kind: 'sometimes',
      required: false,
      when: 'depends on model',
    })
  })

  it('reads visibleFor for a function condition, and keeps it optional when visible', () => {
    const channel = subBlock({
      id: 'channel',
      required: true,
      condition: { opaque: true },
      visibleFor: { send: true, list_users: false },
    })
    const sendContext = buildVisibilityContext([channel], { operation: 'send' })
    const listContext = buildVisibilityContext([channel], { operation: 'list_users' })
    expect(classifyParam([channel], sendContext)).toMatchObject({
      kind: 'sometimes',
      required: false,
    })
    expect(classifyParam([channel], listContext).kind).toBe('never')
  })

  it('merges a duplicated id: visible wherever any declaration is', () => {
    const copies = [
      subBlock({ id: 'temperature', condition: { field: 'provider', value: 'a' } }),
      subBlock({ id: 'temperature', condition: { field: 'provider', value: 'b' } }),
    ]
    const context = buildVisibilityContext([dropdown('provider', ['a', 'b']), ...copies], {})
    expect(classifyParam(copies, context).kind).toBe('always')
  })

  it('evaluates `not` and `and` like evaluateSubBlockCondition', () => {
    const field = subBlock({
      id: 'rerankerModel',
      condition: { field: 'mode', value: ['x'], not: true, and: { field: 'enabled', value: true } },
    })
    const context = buildVisibilityContext(
      [dropdown('mode', ['x', 'y']), subBlock({ id: 'enabled', type: 'switch' }), field],
      {}
    )
    const visibility = classifyParam([field], context)
    const visibleCombos = context.combos.filter((_, index) => visibility.visible[index])
    expect(visibleCombos).toEqual([{ enabled: true, mode: 'y' }])
  })
})

describe('buildVisibilityContext', () => {
  it(`caps combinations at ${MAX_COMBINATIONS}, dropping the widest siblings first`, () => {
    const siblings = [
      dropdown(
        'wide',
        Array.from({ length: 40 }, (_, i) => `w${i}`)
      ),
      dropdown('a', ['1', '2', '3', '4']),
      dropdown('b', ['1', '2', '3', '4']),
      dropdown('c', ['1', '2', '3', '4']),
      dropdown('d', ['1', '2']),
    ]
    const reader = subBlock({
      id: 'reader',
      condition: { field: 'wide', value: 'w1', and: { field: 'a', value: '1' } },
      required: { field: 'b', value: '1', and: { field: 'c', value: '1' } },
    })
    const dReader = subBlock({ id: 'dReader', condition: { field: 'd', value: '1' } })
    const context = buildVisibilityContext([...siblings, reader, dReader], {})
    expect(context.combos.length).toBeLessThanOrEqual(MAX_COMBINATIONS)
    expect(context.siblings.map((sibling) => sibling.field)).not.toContain('wide')
    expect(context.combos.length).toBe(32)
  })
})

describe('findGate', () => {
  function gateFor(candidates: CatalogSubBlock[]) {
    const context = buildVisibilityContext(candidates, {})
    const params = candidates.map((candidate) => ({
      name: candidate.canonicalParamId ?? candidate.id,
      visibility: classifyParam([candidate], context) as ParamVisibility,
    }))
    const always = new Set(params.filter((p) => p.visibility.kind === 'always').map((p) => p.name))
    return findGate(params, context, always)
  }

  it('nests one union level on a small dropdown that gates disjoint fields', () => {
    const gate = gateFor([
      dropdown('authMethod', ['oauth', 'bot_token']),
      subBlock({
        id: 'credential',
        required: true,
        condition: { field: 'authMethod', value: 'oauth' },
      }),
      subBlock({
        id: 'botToken',
        required: true,
        condition: { field: 'authMethod', value: 'bot_token' },
      }),
    ])
    expect(gate).toEqual({
      field: 'authMethod',
      variants: [
        { values: ['oauth'], params: [{ name: 'credential', required: true }] },
        { values: ['bot_token'], params: [{ name: 'botToken', required: true }] },
      ],
    })
  })

  it('does not nest on a dropdown with more than four options', () => {
    const options = ['a', 'b', 'c', 'd', 'e']
    expect(
      gateFor([
        dropdown('kind', options),
        subBlock({ id: 'onlyA', condition: { field: 'kind', value: 'a' } }),
      ])
    ).toBeNull()
  })

  it('merges gate values whose fields are identical', () => {
    const gate = gateFor([
      dropdown('memoryType', ['none', 'conversation', 'sliding_window']),
      subBlock({
        id: 'conversationId',
        condition: { field: 'memoryType', value: ['conversation', 'sliding_window'] },
      }),
    ])
    expect(gate?.variants.map((variant) => variant.values)).toEqual([
      ['none'],
      ['conversation', 'sliding_window'],
    ])
  })
})
