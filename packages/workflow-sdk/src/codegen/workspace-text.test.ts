import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { WORKSPACE_SDK_DTS } from './workspace-text.generated'

describe('WORKSPACE_SDK_DTS', () => {
  it('matches src/workspace/*.d.ts, so bundled consumers never write stale declarations', () => {
    const dir = path.join(import.meta.dirname, '..', 'workspace')
    const files = Object.fromEntries(
      readdirSync(dir)
        .filter((name) => name.endsWith('.d.ts'))
        .map((name) => [name, readFileSync(path.join(dir, name), 'utf8')])
    )
    expect(WORKSPACE_SDK_DTS).toEqual(files)
  })
})
