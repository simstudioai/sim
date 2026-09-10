/**
 * @vitest-environment node
 *
 * Exercises the actual worker with SIM_HELPERS_SMOKE=1 and a compatible Node build.
 */
import { describe, expect, it } from 'vitest'
import { executeInIsolatedVM } from '@/lib/execution/isolated-vm'

function run(code: string, timeoutMs = 5000) {
  return executeInIsolatedVM({
    code,
    params: {},
    envVars: {},
    contextVariables: {},
    timeoutMs,
    requestId: 'function-globals-smoke',
  })
}

describe.skipIf(process.env.SIM_HELPERS_SMOKE !== '1')('Function globals in a real isolate', () => {
  it('uses Buffer and text codecs without imports or a remote sandbox', async () => {
    const result = await run(`
      const payload = { text: 'Hello 🌍' }
      const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
      const decoded = new TextDecoder().decode(new TextEncoder().encode(payload.text))
      return { encoded, decoded, binary: atob(btoa('hello')), zero: Buffer.allocUnsafe(32).every(b => b === 0) }
    `)
    expect(result.error).toBeUndefined()
    expect(result.result).toEqual({
      encoded: Buffer.from(JSON.stringify({ text: 'Hello 🌍' }), 'utf8').toString('base64'),
      decoded: 'Hello 🌍',
      binary: 'hello',
      zero: true,
    })
  })

  it('keeps prototypes and host capabilities isolated between executions', async () => {
    const first = await run(`
      Buffer.prototype.polluted = true
      TextEncoder.prototype.polluted = true
      return Buffer.from.constructor('return typeof process + ":" + typeof require')()
    `)
    expect(first.error).toBeUndefined()
    expect(first.result).toBe('undefined:undefined')
    const next = await run(
      'return [Buffer.prototype.polluted === undefined, TextEncoder.prototype.polluted === undefined]'
    )
    expect(next.error).toBeUndefined()
    expect(next.result).toEqual([true, true])
  })

  it('preserves user-code error locations and catches invalid conversions', async () => {
    const result = await run("const data = Buffer.from('hello')\nthrow new Error('expected error')")
    expect(result.error).toMatchObject({
      line: 2,
      lineContent: "throw new Error('expected error')",
    })
    const caught = await run("try { btoa('🌍'); return false } catch { return true }")
    expect(caught.error).toBeUndefined()
    expect(caught.result).toBe(true)
  })

  it('retains timeout enforcement and allows subsequent executions', async () => {
    const result = await run('while (true) { new TextEncoder().encode("hello") }', 100)
    expect(result.error).toBeDefined()
    expect(result.termination).toBe('timeout')
    const next = await run('return Buffer.from("ok").toString()')
    expect(next.error).toBeUndefined()
    expect(next.result).toBe('ok')
  })

  it('charges Buffer allocations to the existing isolate memory limit', async () => {
    const result = await run(
      'const buffers = []; while (true) { buffers.push(Buffer.alloc(16 * 1024 * 1024)) }'
    )
    expect(result.error).toBeDefined()
    expect(result.error?.message).toMatch(
      /memory|disposed|cancelled|Array buffer allocation failed/i
    )
    const next = await run('return Buffer.alloc(4).length')
    expect(next.error).toBeUndefined()
    expect(next.result).toBe(4)
  })
})
