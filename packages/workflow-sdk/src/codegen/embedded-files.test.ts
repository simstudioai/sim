import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { embeddedFolderTexts } from './embedded-files'

describe('embeddedFolderTexts', () => {
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
