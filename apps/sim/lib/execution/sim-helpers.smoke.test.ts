/**
 * @vitest-environment node
 *
 * The `sim.*` helper namespace, exercised in a real isolate.
 *
 * `isolated-vm.test.ts` mocks the spawn, so it never proves the namespace is
 * reachable from user code — only that the process plumbing is called. These
 * cases run the actual worker and assert a value crosses the boundary in both
 * directions, which is the only way the frozen `global.sim` shim and the
 * broker's JSON marshalling are covered at all.
 *
 * Enable with `SIM_HELPERS_SMOKE=1`. Needs `isolated-vm` installed for the
 * running Node (prebuilds exist for 22/24 only; other versions source-build).
 */
import { describe, expect, it } from 'vitest'
import { executeInIsolatedVM, type IsolatedVMBrokerHandler } from '@/lib/execution/isolated-vm'

const smokeEnabled = process.env.SIM_HELPERS_SMOKE === '1'
const CASE_TIMEOUT_MS = 60_000

const FILE = {
  id: 'file_1',
  name: 'notes.txt',
  url: 'https://storage.example/notes.txt',
  size: 11,
  type: 'text/plain',
  key: 'execution/ws/wf/exec/abc/notes.txt',
  context: 'execution',
}

/** Records what user code asked for, and answers the way the runtime does. */
function recordingBrokers(): {
  brokers: Record<string, IsolatedVMBrokerHandler>
  calls: Array<{ name: string; args: unknown }>
} {
  const calls: Array<{ name: string; args: unknown }> = []
  const record =
    (name: string, reply: (args: any) => unknown): IsolatedVMBrokerHandler =>
    async (args: any) => {
      calls.push({ name, args })
      return reply(args)
    }

  return {
    calls,
    brokers: {
      'sim.files.readText': record('sim.files.readText', () => 'hello world'),
      'sim.files.readBase64': record('sim.files.readBase64', () =>
        Buffer.from('hello world').toString('base64')
      ),
      'sim.files.readTextChunk': record('sim.files.readTextChunk', (args) => ({
        content: 'hello'.slice(0, args?.options?.length ?? 5),
        offset: args?.options?.offset ?? 0,
      })),
      'sim.values.read': record('sim.values.read', () => ({ rows: [1, 2, 3] })),
      'sim.values.readArray': record('sim.values.readArray', () => [{ a: 1 }, { a: 2 }]),
    },
  }
}

function run(code: string, brokers: Record<string, IsolatedVMBrokerHandler>) {
  return executeInIsolatedVM(
    {
      code,
      params: {},
      envVars: {},
      contextVariables: { simFile: FILE },
      timeoutMs: 20_000,
      requestId: 'sim-helpers-smoke',
    },
    { brokers }
  )
}

describe.skipIf(!smokeEnabled)('sim.* helpers in a real isolate', () => {
  it(
    'exposes sim.files reads to user code and returns their values',
    async () => {
      const { brokers, calls } = recordingBrokers()

      const result = await run(
        [
          'const text = await sim.files.readText(simFile)',
          'const b64 = await sim.files.readBase64(simFile)',
          'return { text, b64 }',
        ].join('\n'),
        brokers
      )

      expect(result.error).toBeUndefined()
      expect(result.result).toEqual({
        text: 'hello world',
        b64: Buffer.from('hello world').toString('base64'),
      })
      // The file object must cross intact — the broker authorizes on its `key`,
      // so a shim that dropped fields would fail open at the wrong layer.
      expect(calls.map((call) => call.name)).toEqual(['sim.files.readText', 'sim.files.readBase64'])
      expect((calls[0].args as { file: typeof FILE }).file).toEqual(FILE)
    },
    CASE_TIMEOUT_MS
  )

  it(
    'passes options through and returns structured chunk results',
    async () => {
      const { brokers, calls } = recordingBrokers()

      const result = await run(
        'return await sim.files.readTextChunk(simFile, { offset: 0, length: 5 })',
        brokers
      )

      expect(result.error).toBeUndefined()
      expect(result.result).toEqual({ content: 'hello', offset: 0 })
      expect((calls[0].args as { options: unknown }).options).toEqual({ offset: 0, length: 5 })
    },
    CASE_TIMEOUT_MS
  )

  it(
    'exposes sim.values reads for offloaded large values',
    async () => {
      const { brokers } = recordingBrokers()

      const result = await run(
        [
          'const value = await sim.values.read({ __simLargeValueRef: true })',
          'const rows = await sim.values.readArray({ __simLargeValueRef: true })',
          'return { value, rowCount: rows.length }',
        ].join('\n'),
        brokers
      )

      expect(result.error).toBeUndefined()
      expect(result.result).toEqual({ value: { rows: [1, 2, 3] }, rowCount: 2 })
    },
    CASE_TIMEOUT_MS
  )

  it(
    'surfaces a broker rejection as an ordinary error the code can catch',
    async () => {
      const brokers: Record<string, IsolatedVMBrokerHandler> = {
        'sim.files.readText': async () => {
          throw new Error('File is not available in this execution.')
        },
      }

      const result = await run(
        [
          'try {',
          '  await sim.files.readText(simFile)',
          '  return { caught: false }',
          '} catch (error) {',
          '  return { caught: true, message: String(error.message) }',
          '}',
        ].join('\n'),
        brokers
      )

      // A denied read has to reach user code as a catchable error, not kill the
      // isolate — the same file may be optional to the script.
      expect(result.error).toBeUndefined()
      expect(result.result).toMatchObject({ caught: true })
      expect((result.result as { message: string }).message).toContain('not available')
    },
    CASE_TIMEOUT_MS
  )

  it(
    'pins which globals the fast local runtime actually provides',
    async () => {
      const { brokers } = recordingBrokers()

      const result = await run(
        [
          'const names = ["sim","fetch","console","JSON","Uint8Array",',
          '  "Buffer","require","process","atob","TextDecoder","crypto","setTimeout"]',
          'const out = {}',
          'for (const name of names) out[name] = typeof globalThis[name] !== "undefined"',
          'return out',
        ].join('\n'),
        brokers
      )

      expect(result.error).toBeUndefined()
      // The isolate/sandbox split made concrete. The fast runtime is plain
      // ECMAScript plus `fetch` and `sim.*` — no Node built-ins, and notably no
      // `crypto`, `TextDecoder`, or even `setTimeout`. Reaching for any of them
      // is what makes a block need an import, which is what moves it to the
      // slower remote sandbox. The block tip documents exactly this list, so
      // pin it here rather than letting it drift.
      expect(result.result).toEqual({
        sim: true,
        fetch: true,
        console: true,
        JSON: true,
        Uint8Array: true,
        Buffer: false,
        require: false,
        process: false,
        atob: false,
        TextDecoder: false,
        crypto: false,
        setTimeout: false,
      })
    },
    CASE_TIMEOUT_MS
  )

  it(
    'freezes the namespace so user code cannot replace a helper',
    async () => {
      const { brokers } = recordingBrokers()

      const result = await run(
        [
          'let replaced = true',
          'try { sim.files.readText = () => "spoofed" } catch { replaced = false }',
          'const text = await sim.files.readText(simFile)',
          'return { replaced, text }',
        ].join('\n'),
        brokers
      )

      expect(result.error).toBeUndefined()
      // Whether the assignment throws or is silently ignored, the real helper
      // must still be the one that runs.
      expect((result.result as { text: string }).text).toBe('hello world')
    },
    CASE_TIMEOUT_MS
  )
})
