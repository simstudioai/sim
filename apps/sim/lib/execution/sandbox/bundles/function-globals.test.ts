/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { evaluateFunctionGlobals } from '@/lib/execution/sandbox/bundles/verify'

const source = readFileSync(new URL('./function-globals.cjs', import.meta.url), 'utf-8')

function evaluate(code: string): unknown {
  return vm.runInContext(code, evaluateFunctionGlobals(source), { timeout: 5000 })
}

describe('Function data globals', () => {
  it('round-trips Unicode JSON through UTF-8 and base64 without imports', () => {
    expect(
      evaluate(`
      const payload = { text: 'Hello 🌍 — café' }
      const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
      JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
    `)
    ).toEqual({ text: 'Hello 🌍 — café' })
  })

  it('supports Buffer copies, views, concatenation, and numeric reads', () => {
    expect(
      evaluate(`
      const bytes = new Uint8Array([1, 2, 3])
      const copy = Buffer.from(bytes)
      const view = Buffer.from(bytes.buffer, 1, 2)
      bytes[1] = 9
      const number = Buffer.alloc(4)
      number.writeUInt32LE(123456)
      ;({ copy: [...copy], view: [...view], number: number.readUInt32LE(),
         hex: Buffer.concat([copy, view]).toString('hex'), buffer: Buffer.isBuffer(copy) })
    `)
    ).toEqual({ copy: [1, 2, 3], view: [9, 3], number: 123456, hex: '0102030903', buffer: true })
  })

  it('zero-initializes every Buffer allocation API, including unsafe compatibility methods', () => {
    expect(
      evaluate(`
      [Buffer.alloc(64), Buffer.allocUnsafe(64), Buffer.allocUnsafeSlow(64), new Buffer(64)]
        .every(buffer => buffer.length === 64 && buffer.every(byte => byte === 0))
    `)
    ).toBe(true)
  })

  it.each(['', 'Zg', 'Zg==', ' Zg==\n', 'Zh', 'Zm9v', '/w=='])('matches atob for %j', (input) => {
    expect(evaluate(`atob(${JSON.stringify(input)})`)).toBe(atob(input))
  })

  it.each(['a', 'Zg=', 'Zg===', '-_', '☃'])('rejects invalid atob input %j', (input) => {
    expect(() => evaluate(`atob(${JSON.stringify(input)})`)).toThrow()
    expect(() => atob(input)).toThrow()
  })

  it('keeps btoa binary-string semantics instead of silently treating input as UTF-8', () => {
    expect(evaluate("btoa('\u0000\u00ff')")).toBe(btoa('\u0000\u00ff'))
    expect(() => evaluate("btoa('🌍')")).toThrow()
    expect(() => evaluate('atob()')).toThrow()
    expect(() => evaluate('btoa(Symbol())')).toThrow()
  })

  it('encodes UTF-8 and does not split code points when encodeInto runs out of space', () => {
    expect(
      evaluate(`
      const encoder = new TextEncoder()
      const dest = new Uint8Array(4)
      const progress = encoder.encodeInto('a🌍', dest)
      ;({ bytes: [...encoder.encode('a🌍\ud800')], progress, dest: [...dest] })
    `)
    ).toEqual({
      bytes: [...new TextEncoder().encode('a🌍\ud800')],
      progress: { read: 1, written: 1 },
      dest: [97, 0, 0, 0],
    })
  })

  it('decodes byte views, streamed code points, and byte-order marks', () => {
    expect(
      evaluate(`
      const decoder = new TextDecoder()
      const first = decoder.decode(new Uint8Array([0xf0, 0x9f]), { stream: true })
      const second = decoder.decode(new Uint8Array([0x8c, 0x8d]))
      const bytes = new Uint8Array([0, 0xef, 0xbb, 0xbf, 65, 0])
      ;({ first, second, bom: decoder.decode(bytes.subarray(1, 5)),
         preserve: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.subarray(1, 5)) })
    `)
    ).toEqual({ first: '', second: '🌍', bom: 'A', preserve: '\ufeffA' })
  })

  it('supports legacy encodings and rejects malformed data in fatal mode', () => {
    expect(
      evaluate(`
      ({ utf16: new TextDecoder('utf-16le').decode(new Uint8Array([65, 0])),
         latin: new TextDecoder('windows-1252').decode(new Uint8Array([0x80])),
         japanese: new TextDecoder('shift_jis').decode(new Uint8Array([0x82, 0xa0])),
         replacement: new TextDecoder().decode(new Uint8Array([0xff])) })
    `)
    ).toEqual({ utf16: 'A', latin: '€', japanese: 'あ', replacement: '\ufffd' })
    expect(() =>
      evaluate("new TextDecoder('utf8', { fatal: true }).decode(new Uint8Array([255]))")
    ).toThrow()
    expect(() => evaluate("new TextDecoder('not-an-encoding')")).toThrow()
  })

  it('creates constructors inside each context without exposing host capabilities', () => {
    expect(
      evaluate(`
      [Buffer, Buffer.from, TextEncoder, TextDecoder, atob, btoa].map(fn =>
        fn.constructor('return typeof process + ":" + typeof require')())
    `)
    ).toEqual(Array(6).fill('undefined:undefined'))
    const first = evaluateFunctionGlobals(source)
    vm.runInContext(
      'Buffer.prototype.polluted = true; TextDecoder.prototype.polluted = true',
      first
    )
    expect(evaluate('[Buffer.prototype.polluted, TextDecoder.prototype.polluted]')).toEqual([
      undefined,
      undefined,
    ])
    expect(Buffer.prototype).not.toHaveProperty('polluted')
    expect(TextDecoder.prototype).not.toHaveProperty('polluted')
  })
})
