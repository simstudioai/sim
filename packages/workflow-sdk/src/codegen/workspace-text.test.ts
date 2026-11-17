import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { WORKSPACE_COOKBOOK } from './workspace-cookbook-text.generated'
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

  it('matches cookbook/workspace, so bundled consumers never write a stale example', () => {
    const dir = path.join(import.meta.dirname, '..', '..', 'cookbook', 'workspace')
    const files = Object.fromEntries(
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const file = path.relative(dir, path.join(entry.parentPath, entry.name))
          return [file.split(path.sep).join('/'), readFileSync(path.join(dir, file), 'utf8')]
        })
    )
    expect(WORKSPACE_COOKBOOK).toEqual(files)
  })
})
