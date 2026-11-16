import { describe, expect, it } from 'vitest'
import { countMapperOperationReads } from './check-mapper-operation'

/** Wraps a mapper body in the block shape the audit walks. */
function block(mapper: string, extra = ''): string {
  return `${extra}\nexport const XBlock = { tools: { access: [], config: { tool: (p) => p.operation, params: ${mapper} } } }`
}

const count = (source: string) => countMapperOperationReads('x.ts', source)

describe('countMapperOperationReads', () => {
  it('flags every way a mapper can read the operation from its params', () => {
    expect(count(block(`(params) => (params.operation === 'a' ? {} : {})`))).toBe(1)
    expect(count(block(`(params) => (params?.operation === 'a' ? {} : {})`))).toBe(1)
    expect(count(block(`(params) => (params['operation'] === 'a' ? {} : {})`))).toBe(1)
    expect(count(block(`(params) => ((params as X).operation === 'a' ? {} : {})`))).toBe(1)
    expect(count(block(`({ operation }) => (operation === 'a' ? {} : {})`))).toBe(1)
    expect(
      count(
        block(
          `(params) => { const { operation, ...rest } = params; return operation === 'a' ? rest : {} }`
        )
      )
    ).toBe(1)
  })

  it('follows aliases of params and same-file helpers the mapper hands them to', () => {
    expect(
      count(block(`(params) => { const p = params; return p.operation === 'a' ? {} : {} }`))
    ).toBe(1)
    expect(
      count(block(`(params) => { const p = { ...params }; return p.operation ? {} : {} }`))
    ).toBe(1)
    expect(
      count(block(`(params) => { const { a, ...rest } = params; return rest.operation ? {} : {} }`))
    ).toBe(1)
    expect(
      count(
        block(
          '(params) => build(params)',
          `function build(input) { return input.operation === 'a' ? {} : {} }`
        )
      )
    ).toBe(1)
    expect(count(block('mapX', `const mapX = (params) => (params.operation ? {} : {})`))).toBe(1)
  })

  it('tracks the argument position a helper receives params at, a destructured rest, and helper results', () => {
    expect(
      count(
        block(
          '(params) => build({}, params)',
          `function build(options, input) { return input.operation === 'a' ? options : {} }`
        )
      )
    ).toBe(1)
    expect(
      count(
        block(
          '(params) => build(params, {})',
          `function build(input, options) { return options.operation === 'a' ? input : {} }`
        )
      )
    ).toBe(0)
    expect(count(block(`({ credential, ...rest }) => (rest.operation === 'a' ? {} : {})`))).toBe(1)
    expect(
      count(
        block(
          `(params) => { const normalized = normalize(params); return normalized.operation === 'a' ? {} : {} }`,
          'function normalize(input) { return { ...input } }'
        )
      )
    ).toBe(1)
  })

  it('reads helper arguments, destructures from spread aliases, and trusts helpers that build a new object', () => {
    expect(
      count(
        block(
          '(params) => { const built = build(params, params.operation); return built }',
          'function build(input, extra) { return { input, extra } }'
        )
      )
    ).toBe(1)
    expect(
      count(
        block(
          `(params) => { const { operation } = { ...params }; return operation === 'a' ? {} : {} }`
        )
      )
    ).toBe(1)
    expect(
      count(
        block(
          `(params) => { const built = build(params); return built.operation === 'a' ? {} : {} }`,
          `function build(input) { return { operation: 'derived', mode: input.mode } }`
        )
      )
    ).toBe(0)
    expect(
      count(
        block(
          `(params) => { const result = normalize(params); return result.operation === 'a' ? {} : {} }`,
          'function normalize(input) { const copy = { ...input }; return copy }'
        )
      )
    ).toBe(1)
  })

  it('does not count a nested callback parameter that reuses an alias name', () => {
    expect(
      count(block(`(params) => ({ items: params.items.map((params) => params.operation) })`))
    ).toBe(0)
    expect(
      count(
        block(
          `(params) => { const { operation, ...rest } = params; return { list: rest.items.map((operation) => operation) } }`
        )
      )
    ).toBe(0)
  })

  it('does not flag strip-only destructuring, the helper, or the tool selector', () => {
    expect(count(block(`(params) => { const { operation, ...rest } = params; return rest }`))).toBe(
      0
    )
    expect(
      count(block(`(params) => { const { operation: _operation, ...rest } = params; return rest }`))
    ).toBe(0)
    expect(
      count(block(`(params, context) => (mapperOperation(params, context) === 'a' ? {} : {})`))
    ).toBe(0)
    expect(count(block('(params) => ({ ...params })'))).toBe(0)
  })
})
