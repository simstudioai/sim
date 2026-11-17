import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COOKBOOK_TS } from './cookbook-text.generated'

describe('COOKBOOK_TS', () => {
  it('matches cookbook/workflow.ts, so bundled consumers never write a stale example', () => {
    const source = readFileSync(
      path.join(import.meta.dirname, '..', '..', 'cookbook', 'workflow.ts'),
      'utf8'
    )
    expect(COOKBOOK_TS).toBe(source)
  })
})
