import { describe, expect, it } from 'vitest'
import { selectionFromFiles } from '@/app/workspace/[workspaceId]/files/utils/upload-selection'

function selectedFile(name: string, path: string) {
  const file = new File(['content'], name)
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file
}

describe('directory picker hierarchy', () => {
  it('preserves identical leaf names in distinct directories and Unicode path segments', () => {
    const result = selectionFromFiles([
      selectedFile('env.example', 'Project/日本語/env.example'),
      selectedFile('env.example', 'Project/second/env.example'),
      selectedFile('loose.txt', ''),
    ])
    expect(result.directories).toEqual([['Project'], ['Project', '日本語'], ['Project', 'second']])
    expect(result.files.map((entry) => entry.path)).toEqual([
      ['Project', '日本語', 'env.example'],
      ['Project', 'second', 'env.example'],
      ['loose.txt'],
    ])
  })

  it.each(['Project/../file.txt', '/Project/file.txt', 'Project//file.txt', 'Project/ file.txt'])(
    'rejects ambiguous selection %s instead of flattening it',
    (path) => {
      expect(() => selectionFromFiles([selectedFile('file.txt', path)])).toThrow()
    }
  )

  it('rejects a path that names a different file', () => {
    expect(() => selectionFromFiles([selectedFile('actual.txt', 'Project/other.txt')])).toThrow()
  })
})
