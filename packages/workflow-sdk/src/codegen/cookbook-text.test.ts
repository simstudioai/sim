import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COOKBOOK_EXAMPLES } from './cookbook-text.generated'

describe('COOKBOOK_EXAMPLES', () => {
  it('matches cookbook/examples, so bundled consumers never write a stale example', () => {
    const dir = path.join(import.meta.dirname, '..', '..', 'cookbook', 'examples')
    const files = readdirSync(dir).filter((file) => file.endsWith('.ts'))
    expect(
      Object.fromEntries(files.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]))
    ).toEqual(COOKBOOK_EXAMPLES)
  })
})
