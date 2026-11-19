import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { embeddedFolderTexts } from './embedded-files'
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
    const files = embeddedFolderTexts(dir, { recursive: true, include: () => true })
    expect(WORKSPACE_COOKBOOK).toEqual(files)
  })

  it('never embeds a dotfile or a file under a dot folder', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'embedded-'))
    try {
      mkdirSync(path.join(dir, 'tables'))
      mkdirSync(path.join(dir, '.git'))
      writeFileSync(path.join(dir, 'secrets.ts'), 'a')
      writeFileSync(path.join(dir, 'tables', 'plans.ts'), 'b')
      writeFileSync(path.join(dir, '.DS_Store'), 'c')
      writeFileSync(path.join(dir, 'tables', '.plans.ts.swp'), 'd')
      writeFileSync(path.join(dir, '.git', 'HEAD'), 'e')
      expect(embeddedFolderTexts(dir, { recursive: true, include: () => true })).toEqual({
        'secrets.ts': 'a',
        'tables/plans.ts': 'b',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
