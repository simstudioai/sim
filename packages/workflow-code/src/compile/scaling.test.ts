/**
 * Compile steps grow linearly with the workflow (see `growth` for how a case is measured).
 */

import { expectLinearGrowth } from '@sim/testing/helpers/scaling'
import { describe, it } from 'vitest'
import { SOURCE_LIMITS } from '../limits'
import { TEST_CATALOG } from './catalog.test-helpers'
import { stronglyConnected } from './edges'
import { suggestBuilder } from './hints'
import { compileWorkflow } from './index'

const ENTRY = 'workflows/test.ts'

/**
 * `n` api blocks and a function whose code file reads `refs` references `reference(i)` writes,
 * nearly all of them findings past the warning caps.
 */
function compileReading(
  n: number,
  refs: number,
  reference: (i: number) => string,
  context: { knownKeys?: ReadonlySet<string>; envNames?: ReadonlySet<string> }
) {
  const blocks = Array.from({ length: n }, (_, i) => `  const a${i} = api('A${i}', { url: 'x' })`)
  const text = [
    '// @sim-sdk 1',
    "import { api, codeFile, fn, trigger, workflow } from '@sim/workflow-sdk'",
    "export default workflow('Test', {}, () => {",
    "  const start = trigger.start('Start', {})",
    ...blocks,
    "  const f = fn('F', { code: codeFile('./functions/f.js') })",
    '})',
    '',
  ].join('\n')
  const code = Array.from({ length: refs }, (_, i) => `${reference(i)}\n`).join('')
  return () =>
    compileWorkflow({
      entry: { path: ENTRY, text },
      files: new Map([['workflows/functions/f.js', code]]),
      catalog: TEST_CATALOG,
      sdkMajor: 1,
      ...context,
    })
}

describe('compile scaling', () => {
  it('finds the cycles of a block wired to many targets in linear time', () => {
    expectLinearGrowth((n) => {
      const targets = Array.from({ length: n }, (_, i) => `t${i}`)
      const keys = ['hub', ...targets]
      return () => stronglyConnected(keys, (key) => (key === 'hub' ? [...targets] : []))
    }, 5_000)
  })

  it('computes no former-block hint for a reference past the caps', () => {
    // Many references per block, so the hint's scan of every block outweighs compiling them.
    const knownKeys = new Set(['start', 'gone'])
    expectLinearGrowth(
      (n) => compileReading(n, n * 80, () => '$ref.gone.x', { knownKeys }),
      Math.floor((SOURCE_LIMITS.maxBlocks - 40) / 8)
    )
  })

  it('computes no did-you-mean for an env name past the caps', () => {
    expectLinearGrowth((n) => {
      const envNames = new Set(Array.from({ length: n }, (_, i) => `KNOWN_${i}`))
      return compileReading(n, n, (i) => `$env.MISSING_${i}`, { envNames })
    }, 200)
  })

  it('splits a long written method that spans lines in linear time', () => {
    const paths = ['slack.sendMessage', 'slack.getMessage']
    expectLinearGrowth((n) => {
      const written = `slack.${'a'.repeat(n)}\n`
      return () => suggestBuilder(written, paths)
    }, 4_000)
  })
})
