/**
 * @vitest-environment node
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  BUILD_SEARCH_MANIFEST_SCRIPT,
  parseSearchChangeManifest,
} from '@/executor/handlers/pi/cloud-search-manifest'

function write(path: string, content: string, mode: '100644' | '100755' = '100644') {
  const bytes = Buffer.from(content)
  return {
    path,
    mode,
    contentBase64: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

describe('search change manifest', () => {
  it('runs the exporter in isolated Python mode outside the repository cwd', () => {
    expect(BUILD_SEARCH_MANIFEST_SCRIPT).toContain('cd /workspace')
    expect(BUILD_SEARCH_MANIFEST_SCRIPT).toContain('python3 -I -')
    expect(BUILD_SEARCH_MANIFEST_SCRIPT).not.toContain('cd /workspace/repo\npython3')
  })

  it('accepts bounded regular files and deletes', () => {
    expect(
      parseSearchChangeManifest(
        JSON.stringify({
          baseSha: 'a'.repeat(40),
          writes: [write('src/index.ts', 'export const value = 1')],
          deletes: ['src/old.ts'],
        })
      )
    ).toEqual({
      baseSha: 'a'.repeat(40),
      writes: [write('src/index.ts', 'export const value = 1')],
      deletes: ['src/old.ts'],
    })
  })

  it.each([
    '../secret',
    '/absolute',
    '.git/config',
    '.GIT/config',
    'git~1/config',
    '-option',
    'trailing./file',
    'src\\evil',
  ])('rejects unsafe path %s', (path) => {
    expect(() =>
      parseSearchChangeManifest(
        JSON.stringify({
          baseSha: 'a'.repeat(40),
          writes: [write(path, 'x')],
          deletes: [],
        })
      )
    ).toThrow(/invalid/)
  })

  it('rejects content whose hash does not match', () => {
    const item = write('src/index.ts', 'safe')
    item.sha256 = '0'.repeat(64)
    expect(() =>
      parseSearchChangeManifest(
        JSON.stringify({ baseSha: 'a'.repeat(40), writes: [item], deletes: [] })
      )
    ).toThrow(/hash/)
  })

  it('rejects case-colliding paths', () => {
    expect(() =>
      parseSearchChangeManifest(
        JSON.stringify({
          baseSha: 'a'.repeat(40),
          writes: [write('src/File.ts', 'one'), write('src/file.ts', 'two')],
          deletes: [],
        })
      )
    ).toThrow(/case-colliding/)
  })
})
