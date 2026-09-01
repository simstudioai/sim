/**
 * @vitest-environment node
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatGeneratedSource } from './format-generated-source'

const ROOT = path.resolve(import.meta.dirname, '..')

/**
 * The neutral-path workaround (biome refuses stdin paths its config excludes)
 * must preserve the caller's extension: biome parses the stdin as the language
 * the declared path names, so a `.json` document declared as `.ts` aborts with
 * a parse error. That exact regression shipped once — generate:openapi (JSON)
 * broke while generate:cli-api (TS) stayed green.
 */
describe('formatGeneratedSource', () => {
  it('formats JSON output under a JSON-typed neutral path', () => {
    const formatted = formatGeneratedSource(
      '{"a":1,\n  "b": [1,2]}\n',
      path.join(ROOT, 'apps/docs/openapi-probe.json'),
      ROOT
    )
    expect(JSON.parse(formatted)).toEqual({ a: 1, b: [1, 2] })
  })

  it('formats TypeScript output under a TS-typed neutral path', () => {
    const formatted = formatGeneratedSource(
      'export const x = {a: 1}\n',
      path.join(ROOT, 'packages/sim-cli/src/generated/probe.ts'),
      ROOT
    )
    expect(formatted).toContain('export const x')
  })
})
