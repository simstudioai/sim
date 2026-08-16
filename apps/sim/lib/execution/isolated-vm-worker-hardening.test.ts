/**
 * @vitest-environment node
 *
 * Guards the isolate hardening contract in `isolated-vm-worker.cjs`: no raw
 * `ivm.Reference` host bridge may survive as an isolate global once user code
 * runs. Each bootstrap must capture its bridges in a closure and list their
 * global names in its own `undefined_globals`.
 *
 * The two execution paths harden independently, so every assertion is scoped to
 * one path's source slice — a bridge installed by `executeCode` but undefined
 * only by `executeTask` must still fail.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKER_SOURCE = readFileSync(join(__dirname, 'isolated-vm-worker.cjs'), 'utf8')

const EXECUTE_CODE_MARKER = 'async function executeCode('
const EXECUTE_TASK_MARKER = 'async function executeTask('

/**
 * Source of one execution path, from its function declaration to the start of
 * the next one (or end of file for the last path).
 */
function pathSource(marker: string, nextMarker?: string): string {
  const start = WORKER_SOURCE.indexOf(marker)
  expect(start, `${marker} not found — worker layout changed`).toBeGreaterThan(-1)
  const end = nextMarker ? WORKER_SOURCE.indexOf(nextMarker, start) : WORKER_SOURCE.length
  expect(end, `${nextMarker} not found — worker layout changed`).toBeGreaterThan(start)
  return WORKER_SOURCE.slice(start, end)
}

const EXECUTION_PATHS = [
  { name: 'executeCode', source: pathSource(EXECUTE_CODE_MARKER, EXECUTE_TASK_MARKER) },
  { name: 'executeTask', source: pathSource(EXECUTE_TASK_MARKER) },
]

/**
 * Globals bound to a raw `ivm.Reference`. The worker names these `__*Ref`;
 * `ivm.Callback` bridges (`__log`, `__textEncode`, …) are plain isolate
 * functions that expose no host handle and are deliberately not matched.
 */
function referenceBridges(source: string): string[] {
  return [...source.matchAll(/jail\.set\('(__\w+Ref)'/g)].map((match) => match[1])
}

function hardeningList(source: string): string {
  const list = source.match(/const undefined_globals = \[[\s\S]*?\]/)
  expect(list, 'no undefined_globals hardening list in this execution path').not.toBeNull()
  return (list as RegExpMatchArray)[0]
}

describe('isolated-vm worker hardening', () => {
  it.each(EXECUTION_PATHS)(
    '$name undefines every ivm.Reference bridge it installs',
    ({ name, source }) => {
      const bridges = referenceBridges(source)
      expect(
        bridges.length,
        `${name} installs no __*Ref bridges — detection is stale`
      ).toBeGreaterThan(0)

      const list = hardeningList(source)
      for (const bridge of bridges) {
        expect(
          list.includes(`'${bridge}'`),
          `${name} sets ${bridge} as an isolate global but its hardening list omits it`
        ).toBe(true)
      }
    }
  )

  it.each(EXECUTION_PATHS)('$name undefines the isolated-vm escape globals', ({ source }) => {
    const list = hardeningList(source)
    for (const name of ['Isolate', 'Context', 'Script', 'Reference', 'ExternalCopy']) {
      expect(list).toContain(`'${name}'`)
    }
  })
})
