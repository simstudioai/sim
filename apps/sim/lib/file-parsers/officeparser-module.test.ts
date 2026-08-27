/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveParseOfficeAsync } from '@/lib/file-parsers/officeparser-module'

const parse = async () => 'slide text'

describe('resolveParseOfficeAsync', () => {
  /**
   * Node and webpack synthesize named exports from `officeparser`'s CommonJS
   * `module.exports`, so this is the shape the app server sees — and the only
   * one the code used to handle.
   */
  it('resolves the named export when the bundler synthesizes one', () => {
    expect(resolveParseOfficeAsync({ parseOfficeAsync: parse })).toBe(parse)
  })

  /**
   * esbuild — which builds the Trigger.dev worker — puts `module.exports` on
   * `default` and leaves the named export undefined. Reading the named export
   * directly yielded `undefined` there, and calling it threw
   * `TypeError: parseOfficeAsync is not a function`, which every parser treats
   * as a library failure and answers with a `degraded` scrape that the document
   * pipeline then rejects. This is the shape that broke production: every
   * `.pptx` and legacy `.doc` from a connector reported "No text could be
   * extracted" while the same files parsed fine through the app.
   */
  it('resolves through default when the bundler namespaces the CommonJS exports', () => {
    expect(resolveParseOfficeAsync({ default: { parseOfficeAsync: parse } })).toBe(parse)
  })

  /** A CommonJS module whose `module.exports` IS the function. */
  it('resolves a default export that is itself callable', () => {
    expect(resolveParseOfficeAsync({ default: parse })).toBe(parse)
  })

  /**
   * Fails loudly rather than handing back `undefined` for a caller to invoke —
   * the undefined call is what produced a misleading "no text could be
   * extracted" report instead of naming the real fault.
   */
  it('throws when no shape exposes the entry point', () => {
    expect(() => resolveParseOfficeAsync({})).toThrow('did not expose parseOfficeAsync')
  })
})
