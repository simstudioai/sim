import { describe, expect, it } from 'vitest'
import { isFolderPathWithinScope, isWithinFolderScope } from '@/lib/folders/scope'

describe('isWithinFolderScope', () => {
  it('treats the empty scope as the workspace root, which holds everything', () => {
    expect(isWithinFolderScope(['Reports', 'Q3'], [])).toBe(true)
    expect(isWithinFolderScope([], [])).toBe(true)
    expect(isWithinFolderScope(['Reports'], [], { includeSubfolders: false })).toBe(true)
  })

  it('includes descendants by default and only the folder itself when told not to', () => {
    expect(isWithinFolderScope(['Reports', 'Q3'], ['Reports'])).toBe(true)
    expect(isWithinFolderScope(['Reports', 'Q3'], ['Reports'], { includeSubfolders: false })).toBe(
      false
    )
    expect(isWithinFolderScope(['Reports'], ['Reports'], { includeSubfolders: false })).toBe(true)
  })

  it('does not mistake a shared name prefix for an ancestry', () => {
    expect(isWithinFolderScope(['Reports Archive'], ['Reports'])).toBe(false)
  })

  it('is false for a folder above the scope', () => {
    expect(isWithinFolderScope(['Reports'], ['Reports', 'Q3'])).toBe(false)
  })
})

describe('isFolderPathWithinScope', () => {
  it('reads a slash inside a folder name as one level, not two', () => {
    /* One folder genuinely named `Q3/Q4`, not a `Q3` holding a `Q4`. */
    expect(isFolderPathWithinScope('/Reports/Q3%2FQ4', '/Reports/Q3')).toBe(false)
    expect(isFolderPathWithinScope('/Reports/Q3%2FQ4', '/Reports/Q3%2FQ4')).toBe(true)
    expect(isFolderPathWithinScope('/Reports/Q3%2FQ4/Drafts', '/Reports/Q3%2FQ4')).toBe(true)
    expect(isFolderPathWithinScope('/Reports/Q3', '/Reports/Q3%2FQ4')).toBe(false)
  })

  it('scopes to the whole workspace for the root path', () => {
    expect(isFolderPathWithinScope('/Reports/Q3', '/')).toBe(true)
    expect(isFolderPathWithinScope('/', '/')).toBe(true)
  })

  it('matches an exact folder and its descendants', () => {
    expect(isFolderPathWithinScope('/Reports', '/Reports')).toBe(true)
    expect(isFolderPathWithinScope('/Reports/Q3%20Results', '/Reports')).toBe(true)
    expect(
      isFolderPathWithinScope('/Reports/Q3%20Results', '/Reports', { includeSubfolders: false })
    ).toBe(false)
  })

  it('rejects a path that is not canonical', () => {
    expect(() => isFolderPathWithinScope('Reports', '/Reports')).toThrow()
    expect(() => isFolderPathWithinScope('/Reports/', '/Reports')).toThrow()
  })
})
