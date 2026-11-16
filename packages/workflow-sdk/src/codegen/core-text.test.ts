import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CORE_DTS } from './core-text.generated'

describe('CORE_DTS', () => {
  it('matches src/core.d.ts, so bundled consumers never write stale declarations', () => {
    const source = readFileSync(path.join(import.meta.dirname, '..', 'core.d.ts'), 'utf8')
    expect(CORE_DTS).toBe(source)
  })
})
