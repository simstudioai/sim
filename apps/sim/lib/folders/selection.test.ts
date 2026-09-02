/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { readFolderPath, readFolderPaths, replaceFolderPath } from '@/lib/folders/selection'

describe('folder selector persistence', () => {
  it('reads a legacy single path', () => {
    expect(readFolderPaths('/Reports')).toEqual(['/Reports'])
    expect(readFolderPath('/Reports')).toBe('/Reports')
  })

  it('reads and deduplicates a multi-folder value', () => {
    expect(readFolderPaths([' /Reports ', '/Archive', '/Reports'])).toEqual([
      '/Reports',
      '/Archive',
    ])
  })

  it('reads the serialized array written by an earlier selector revision', () => {
    expect(readFolderPaths('["/Reports","/Archive"]')).toEqual(['/Reports', '/Archive'])
  })

  it('replaces a single folder path without changing scalar storage', () => {
    expect(replaceFolderPath('/Reports', '/Reports', '/Target')).toBe('/Target')
    expect(replaceFolderPath('/Archive', '/Reports', '/Target')).toBe('/Archive')
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
