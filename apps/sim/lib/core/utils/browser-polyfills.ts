/**
 * Polyfills for `Promise.withResolvers` (Safari < 17.4, Chrome < 119) and
 * `URL.parse` (Safari < 18, Chrome < 126), which pdf.js 5.x calls at
 * module-evaluation time. Without them, importing `react-pdf`/`pdfjs-dist`
 * throws before anything renders, so this module must be imported for its
 * side effects BEFORE those imports. The pdf.js worker runs in a separate
 * context these polyfills cannot reach; it is covered by serving pdf.js's
 * self-polyfilling legacy worker build (see pdf-viewer.tsx).
 *
 * Typed locally because the repo TS lib is ES2022, which predates both APIs.
 */

interface PromiseWithResolversResult<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

const promiseCtor = Promise as typeof Promise & {
  withResolvers?: <T>() => PromiseWithResolversResult<T>
}

if (typeof promiseCtor.withResolvers !== 'function') {
  // double-cast-allowed: Node 26 Promise.withResolvers type is a strict intersection
  promiseCtor.withResolvers = (<T>(): PromiseWithResolversResult<T> => {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }) as any
}

const urlCtor = URL as typeof URL & {
  parse?: (url: string | URL, base?: string | URL) => URL | null
}

if (typeof urlCtor.parse !== 'function') {
  urlCtor.parse = (url: string | URL, base?: string | URL): URL | null => {
    try {
      return new URL(url, base)
    } catch {
      return null
    }
  }
}
