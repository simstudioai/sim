import { describe, expect, it } from 'vitest'
import { readFolderPaths, replaceFolderPath } from '@/lib/folders/selection'

describe('folder selector persistence', () => {
  it('reads the serialized array written by an earlier selector revision', () => {
    expect(readFolderPaths('["/Reports","/Archive"]')).toEqual(['/Reports', '/Archive'])
  })

  it('reads a typed comma-separated list, dropping blanks and repeats', () => {
    expect(readFolderPaths('/Reports, /Archive,, /Reports')).toEqual(['/Reports', '/Archive'])
  })

  it('keeps a percent-encoded comma inside one folder name', () => {
    expect(readFolderPaths('/Q3%2CQ4')).toEqual(['/Q3%2CQ4'])
  })

  it('replaces one path in array and serialized-array storage', () => {
    expect(replaceFolderPath(['/Reports', '/Archive'], '/Reports', '/Target')).toEqual([
      '/Target',
      '/Archive',
    ])
    expect(replaceFolderPath('["/Reports","/Archive"]', '/Reports', '/Target')).toBe(
      '["/Target","/Archive"]'
    )
  })

  it('removes only an unresolved path and clears an empty selection', () => {
    expect(replaceFolderPath(['/Reports', '/Archive'], '/Reports', '')).toEqual(['/Archive'])
    expect(replaceFolderPath('["/Reports"]', '/Reports', '')).toBe('')
    expect(replaceFolderPath('/Reports', '/Reports', '')).toBe('')
  })
})
