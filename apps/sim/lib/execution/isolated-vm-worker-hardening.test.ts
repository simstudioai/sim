/**
 * @vitest-environment node
 *
 * Guards the isolate hardening contract in `isolated-vm-worker.cjs`: no raw
 * `ivm.Reference` host bridge may survive as an isolate global once user code
 * runs. The bootstrap must capture each bridge in a closure and list its global
 * name in `undefined_globals`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKER_SOURCE = readFileSync(join(__dirname, 'isolated-vm-worker.cjs'), 'utf8')

/** Global names bound to a raw `ivm.Reference` (as opposed to an `ivm.Callback`). */
const REFERENCE_BRIDGES = [
  '__fetchRef',
  '__brokerRef',
  '__setTimeoutRef',
  '__clearTimeoutRef',
  '__setIntervalRef',
]

function hardeningLists(): string[] {
  const lists = WORKER_SOURCE.match(/const undefined_globals = \[[\s\S]*?\]/g)
  expect(lists).not.toBeNull()
  return lists as string[]
}

describe('isolated-vm worker hardening', () => {
  it('undefines every ivm.Reference bridge it installs as a global', () => {
    const lists = hardeningLists()
    expect(lists.length).toBeGreaterThanOrEqual(2)

    for (const bridge of REFERENCE_BRIDGES) {
      const installed = WORKER_SOURCE.includes(`jail.set('${bridge}'`)
      if (!installed) continue
      const undefinedSomewhere = lists.some((list) => list.includes(`'${bridge}'`))
      expect(undefinedSomewhere, `${bridge} is set as an isolate global but never undefined`).toBe(
        true
      )
    }
  })

  it('keeps the isolated-vm escape globals in every hardening list', () => {
    for (const list of hardeningLists()) {
      for (const name of ['Isolate', 'Context', 'Script', 'Reference', 'ExternalCopy']) {
        expect(list).toContain(`'${name}'`)
      }
    }
  })
})
