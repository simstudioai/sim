import { describe, expect, it } from 'vitest'
import {
  findRealWaitViolations,
  findStubAndHookViolations,
  parseSource,
} from './check-test-patterns'

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

describe('real-wait', () => {
  const HELPERS = "import { sleep, interruptibleSleep } from '@sim/utils/helpers'"

  function waits(source: string, file = 'apps/sim/lib/example.test.ts') {
    return findRealWaitViolations(file, parseSource(file, source)).map(({ detail }) => detail)
  }

  it.each<[string, string[], string[]]>([
    ['an imported sleep', [HELPERS, "it('t', async () => { await sleep(10) })"], ['sleep() #1']],
    [
      'an aliased sleep',
      ["import { sleep as wait } from '@sim/utils/helpers'", 'await wait(10)'],
      ['sleep() #1'],
    ],
    [
      'interruptibleSleep',
      [HELPERS, 'await interruptibleSleep(10, signal)'],
      ['interruptibleSleep() #1'],
    ],
    ['a sleep with a computed delay', [HELPERS, 'await sleep(delayMs)'], ['sleep() #1']],
    [
      'timers/promises setTimeout',
      ["import { setTimeout as delay } from 'node:timers/promises'", 'await delay(50)'],
      ['timers/promises setTimeout() #1'],
    ],
    [
      'a promise resolved by setTimeout',
      ['await new Promise((r) => setTimeout(r, 5))'],
      ['setTimeout promise #1'],
    ],
    [
      'a promise resolved from a setTimeout callback',
      ['await new Promise<void>((resolve) => { globalThis.setTimeout(() => resolve(), ms) })'],
      ['setTimeout promise #1'],
    ],
    [
      'fake timers that leave setTimeout real',
      [HELPERS, "beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }) })", 'await sleep(10)'],
      ['sleep() #1'],
    ],
    [
      'fake timers that advance with the wall clock',
      [
        HELPERS,
        "it('t', async () => {",
        '  vi.useFakeTimers({ shouldAdvanceTime: true })',
        '  await sleep(10)',
        '})',
      ],
      ['sleep() #1'],
    ],
    [
      'a sleep before the test installs fake timers',
      [HELPERS, "it('t', async () => {", '  await sleep(10)', '  vi.useFakeTimers()', '})'],
      ['sleep() #1'],
    ],
    [
      'a sleep in a test beside one that installs fake timers',
      [
        HELPERS,
        "it('a', () => { vi.useFakeTimers() })",
        "it('b', async () => { await sleep(10) })",
      ],
      ['sleep() #1'],
    ],
    [
      'a sleep before the install in the hook that installs fake timers',
      [
        HELPERS,
        "describe('d', () => {",
        '  beforeEach(async () => {',
        '    await sleep(100)',
        '    vi.useFakeTimers()',
        '  })',
        "  it('t', async () => { await sleep(10) })",
        '})',
      ],
      ['sleep() #1'],
    ],
    [
      'a sleep after the test restores real timers',
      [
        HELPERS,
        "it('t', async () => {",
        '  vi.useFakeTimers()',
        '  vi.useRealTimers()',
        '  await sleep(10)',
        '})',
      ],
      ['sleep() #1'],
    ],
    [
      'a sleep in a nested suite that restores real timers',
      [
        HELPERS,
        "describe('outer', () => {",
        '  beforeEach(() => { vi.useFakeTimers() })',
        "  describe('inner', () => {",
        '    beforeEach(() => { vi.useRealTimers() })',
        "    it('t', async () => { await sleep(10) })",
        '  })',
        '})',
      ],
      ['sleep() #1'],
    ],
    [
      'a sleep in a beforeAll beside a beforeEach that installs fake timers',
      [
        HELPERS,
        'beforeEach(() => { vi.useFakeTimers() })',
        'beforeAll(async () => { await sleep(10) })',
      ],
      ['sleep() #1'],
    ],
    [
      'a sleep in a beforeEach declared before the one that installs fake timers',
      [
        HELPERS,
        'beforeEach(async () => { await sleep(10) })',
        'beforeEach(() => { vi.useFakeTimers() })',
      ],
      ['sleep() #1'],
    ],
    [
      'fake timers with a config the AST cannot read',
      [
        HELPERS,
        'beforeEach(() => { vi.useFakeTimers(config) })',
        "it('t', async () => { await sleep(10) })",
      ],
      ['sleep() #1'],
    ],
    [
      'fake timers with a spread config',
      [
        HELPERS,
        "it('t', async () => {",
        '  vi.useFakeTimers({ ...config })',
        '  await sleep(10)',
        '})',
      ],
      ['sleep() #1'],
    ],
    [
      'namespace imports',
      [
        "import * as helpers from '@sim/utils/helpers'",
        "import * as timers from 'node:timers/promises'",
        'await helpers.sleep(10)',
        'await timers.setTimeout(10)',
      ],
      ['sleep() #1', 'timers/promises setTimeout() #1'],
    ],
    [
      'a module-scope wait before a module-scope install',
      [HELPERS, 'await sleep(10)', 'vi.useFakeTimers()'],
      ['sleep() #1'],
    ],
    [
      'a helper wait after module-scope real timers are restored',
      [
        HELPERS,
        'async function settle() { await sleep(10) }',
        'vi.useFakeTimers()',
        'vi.useRealTimers()',
      ],
      ['sleep() #1'],
    ],
    [
      'a helper called at module scope before a module-scope install',
      [
        HELPERS,
        'async function settle() { await sleep(10) }',
        'await settle()',
        'vi.useFakeTimers()',
      ],
      ['sleep() #1'],
    ],
    [
      'an arrow helper called at module scope before a module-scope install',
      [
        HELPERS,
        'const settle = async () => { await sleep(10) }',
        'await settle()',
        'vi.useFakeTimers()',
      ],
      ['sleep() #1'],
    ],
    [
      'a wrapped arrow helper called at module scope before a module-scope install',
      [
        HELPERS,
        'const settle = (async () => { await sleep(10) }) satisfies (() => Promise<void>)',
        'await settle()',
        'vi.useFakeTimers()',
      ],
      ['sleep() #1'],
    ],
    [
      'every occurrence, numbered per kind',
      [HELPERS, 'await sleep(10)', 'await new Promise((r) => setTimeout(r, 5))', 'await sleep(20)'],
      ['sleep() #1', 'setTimeout promise #1', 'sleep() #2'],
    ],
  ])('flags %s', (_name, lines, expected) => {
    expect(waits(lines.join('\n'))).toEqual(expected)
  })

  it.each<[string, string[]]>([
    [
      'a sleep not imported from @sim/utils/helpers',
      ["import { sleep } from './helpers'", 'await sleep(10)'],
    ],
    [
      'a mocked @sim/utils/helpers',
      [HELPERS, "vi.mock('@sim/utils/helpers', () => utilsHelpersMock)", 'await sleep(10)'],
    ],
    ['a zero-delay sleep', [HELPERS, 'await sleep(0)']],
    [
      'a zero-delay setTimeout promise',
      ['await new Promise((r) => setTimeout(r, 0))', 'await new Promise((r) => setTimeout(r))'],
    ],
    [
      'a setTimeout that only rejects',
      [
        "await new Promise((resolve, reject) => setTimeout(() => reject(new Error('timeout')), 50))",
      ],
    ],
    [
      'a sleep after the test installs fake timers',
      [
        HELPERS,
        "it('t', async () => {",
        '  vi.useFakeTimers()',
        '  const done = sleep(10)',
        '  await vi.advanceTimersByTimeAsync(10)',
        '  await done',
        '})',
      ],
    ],
    [
      'a sleep in a describe whose beforeEach installs fake timers',
      [
        HELPERS,
        "describe('d', () => {",
        "  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout'] }) })",
        "  it('t', async () => { await sleep(10) })",
        '})',
      ],
    ],
    [
      'a sleep under a module-level beforeAll that installs fake timers',
      [HELPERS, "it('t', async () => { await sleep(10) })", 'beforeAll(() => vi.useFakeTimers())'],
    ],
    [
      'a sleep after the install in the hook that installs fake timers',
      [HELPERS, 'beforeAll(async () => {', '  vi.useFakeTimers()', '  await sleep(100)', '})'],
    ],
    [
      'a sleep after real timers are restored and fake ones installed again',
      [
        HELPERS,
        "it('t', async () => {",
        '  vi.useRealTimers()',
        '  vi.useFakeTimers()',
        '  await sleep(10)',
        '})',
      ],
    ],
    [
      'a sleep in an afterEach beside a beforeEach that installs fake timers',
      [
        HELPERS,
        'beforeEach(() => { vi.useFakeTimers() })',
        'afterEach(async () => { await sleep(10) })',
      ],
    ],
    [
      'a helper declared before a module-scope install',
      [
        HELPERS,
        "vi.mock('@/lib/example', () => ({}))",
        'const mocks = vi.hoisted(() => ({ run: vi.fn() }))',
        'const DELAY_MS = 10',
        'type Options = { delay: number }',
        'async function settle() { await sleep(DELAY_MS) }',
        'const settleLater = async () => { await settle() }',
        'const run = vi.fn()',
        'const fixture = createFixture()',
        'vi.useFakeTimers()',
        'await settle()',
        "it('t', async () => { await settle() })",
      ],
    ],
  ])('ignores %s', (_name, lines) => {
    expect(waits(lines.join('\n'))).toEqual([])
  })

  it.each(['apps/sim/lib/example.integration.ts', 'apps/sim/tools/example.live.test.ts'])(
    'exempts %s, which waits on real services',
    (file) => {
      expect(waits([HELPERS, 'await sleep(10)'].join('\n'), file)).toEqual([])
    }
  )
})
