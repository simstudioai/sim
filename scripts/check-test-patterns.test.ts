import { describe, expect, it } from 'vitest'
import { findStubAndHookViolations, parseSource } from './check-test-patterns'

function rules(source: string, file = 'apps/sim/lib/example.test.ts') {
  return findStubAndHookViolations(file, parseSource(file, source)).map(
    ({ rule, detail }) => `${rule}:${detail}`
  )
}

describe('module-scope-stub', () => {
  it('flags stubs at module scope, including exported, cast and chained ones', () => {
    const source = [
      "vi.stubGlobal('fetch', vi.fn())",
      "vi.stubEnv('NODE_ENV', 'test')",
      "const spy = vi.spyOn(console, 'error')",
      "export const fetchMock = vi.stubGlobal('fetch', vi.fn())",
      "const cast = vi.spyOn(Date, 'now') as Mock",
      "const satisfied = vi.spyOn(Date, 'now') satisfies Mock",
      "const chained = vi.spyOn(Date, 'now').mockReturnValue(0)",
      "const wrapped = (vi.spyOn(Date, 'now') as Mock).mockReturnValue(0)",
    ].join('\n')
    expect(rules(source)).toEqual([
      'module-scope-stub:vi.stubGlobal()',
      'module-scope-stub:vi.stubEnv()',
      'module-scope-stub:vi.spyOn()',
      'module-scope-stub:vi.stubGlobal()',
      'module-scope-stub:vi.spyOn()',
      'module-scope-stub:vi.spyOn()',
      'module-scope-stub:vi.spyOn()',
      'module-scope-stub:vi.spyOn()',
    ])
  })

  it('ignores stubs inside hooks and tests', () => {
    const source = [
      'beforeEach(() => {',
      "  vi.stubGlobal('fetch', vi.fn())",
      "  vi.spyOn(Date, 'now').mockReturnValue(0)",
      '})',
      "it('works', () => {",
      "  vi.stubEnv('NODE_ENV', 'test')",
      '})',
    ].join('\n')
    expect(rules(source)).toEqual([])
  })

  it('exempts integration files', () => {
    expect(rules("vi.stubEnv('NODE_ENV', 'test')", 'apps/sim/lib/example.integration.ts')).toEqual(
      []
    )
  })
})

describe('redundant-hook', () => {
  it('flags a leading reset in beforeEach', () => {
    const source = ['beforeEach(() => {', '  vi.clearAllMocks()', '  setup()', '})'].join('\n')
    expect(rules(source)).toEqual(['redundant-hook:vi.clearAllMocks()'])
  })

  it('allows a reset after setup statements in beforeEach', () => {
    const source = ['beforeEach(() => {', '  setup()', '  vi.clearAllMocks()', '})'].join('\n')
    expect(rules(source)).toEqual([])
  })

  it('flags every reset in afterEach, wherever it sits', () => {
    const source = [
      'afterEach(() => {',
      '  cleanup()',
      '  vi.restoreAllMocks()',
      '  vi.unstubAllGlobals()',
      '})',
    ].join('\n')
    expect(rules(source)).toEqual([
      'redundant-hook:vi.restoreAllMocks()',
      'redundant-hook:vi.unstubAllGlobals()',
    ])
  })
})
