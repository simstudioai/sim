/**
 * Isolate-side polyfills. Must run BEFORE the library imports (and before
 * `process/browser` in particular), because `process/browser` captures
 * `setTimeout` at module-init time.
 *
 * Only imported from bundle entries in `build.ts`; not for direct use
 * elsewhere.
 */

type TimerFn = (fn: () => void) => number

const g = globalThis as unknown as Record<string, unknown>

if (typeof g.global === 'undefined') g.global = globalThis
if (typeof g.globalThis === 'undefined') (g as Record<string, unknown>).globalThis = globalThis

const microtask: TimerFn = (fn) => {
  try {
    Promise.resolve().then(fn)
  } catch {
    fn()
  }
  return 0
}

if (typeof g.setTimeout === 'undefined') {
  g.setTimeout = microtask
  g.clearTimeout = () => {}
}
if (typeof g.setImmediate === 'undefined') {
  g.setImmediate = microtask
  g.clearImmediate = () => {}
}
if (typeof g.setInterval === 'undefined') {
  g.setInterval = () => 0
  g.clearInterval = () => {}
}
if (typeof g.queueMicrotask === 'undefined') {
  g.queueMicrotask = (fn: () => void) => {
    Promise.resolve().then(fn)
  }
}

if (typeof g.TextEncoder === 'undefined') {
  g.TextEncoder = class TextEncoder {
    get encoding() {
      return 'utf-8'
    }
    encode(input?: string): Uint8Array {
      const str = String(input == null ? '' : input)
      const bytes: number[] = []
      for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i)
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
          const next = str.charCodeAt(i + 1)
          if (next >= 0xdc00 && next <= 0xdfff) {
            code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
            i++
          }
        }
        if (code < 0x80) {
          bytes.push(code)
        } else if (code < 0x800) {
          bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
        } else if (code < 0x10000) {
          bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
        } else {
          bytes.push(
            0xf0 | (code >> 18),
            0x80 | ((code >> 12) & 0x3f),
            0x80 | ((code >> 6) & 0x3f),
            0x80 | (code & 0x3f)
          )
        }
      }
      return new Uint8Array(bytes)
    }
  }
}

if (typeof g.TextDecoder === 'undefined') {
  g.TextDecoder = class TextDecoder {
    private _label: string
    constructor(label?: string) {
      this._label = (label || 'utf-8').toLowerCase()
    }
    get encoding() {
      return this._label
    }
    decode(input?: BufferSource): string {
      if (!input) return ''
      const bytes =
        input instanceof Uint8Array
          ? input
          : ArrayBuffer.isView(input)
            ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
            : new Uint8Array(input as ArrayBuffer)
      let out = ''
      let i = 0
      while (i < bytes.length) {
        const b1 = bytes[i++]
        if (b1 < 0x80) {
          out += String.fromCharCode(b1)
        } else if (b1 < 0xc0) {
          out += '\ufffd'
        } else if (b1 < 0xe0) {
          const b2 = bytes[i++] & 0x3f
          out += String.fromCharCode(((b1 & 0x1f) << 6) | b2)
        } else if (b1 < 0xf0) {
          const b2 = bytes[i++] & 0x3f
          const b3 = bytes[i++] & 0x3f
          out += String.fromCharCode(((b1 & 0x0f) << 12) | (b2 << 6) | b3)
        } else {
          const b2 = bytes[i++] & 0x3f
          const b3 = bytes[i++] & 0x3f
          const b4 = bytes[i++] & 0x3f
          let cp = ((b1 & 0x07) << 18) | (b2 << 12) | (b3 << 6) | b4
          cp -= 0x10000
          out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
        }
      }
      return out
    }
  }
}

export {}
