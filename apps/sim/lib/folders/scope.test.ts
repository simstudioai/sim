import { describe, expect, it } from 'vitest'
import {
  isFolderPathWithinScope,
  isWithinFolderIdScope,
  isWithinFolderScope,
} from '@/lib/folders/scope'

describe('isWithinFolderScope', () => {
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
})

describe('isFolderPathWithinScope', () => {
  it('reads a slash inside a folder name as one level, not two', () => {
    /* One folder genuinely named `Q3/Q4`, not a `Q3` holding a `Q4`. */
    expect(isFolderPathWithinScope('/Reports/Q3%2FQ4', '/Reports/Q3')).toBe(false)
    expect(isFolderPathWithinScope('/Reports/Q3%2FQ4', '/Reports/Q3%2FQ4')).toBe(true)
    expect(isFolderPathWithinScope('/Reports/Q3%2FQ4/Drafts', '/Reports/Q3%2FQ4')).toBe(true)
    expect(isFolderPathWithinScope('/Reports/Q3', '/Reports/Q3%2FQ4')).toBe(false)
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

describe('isWithinFolderIdScope', () => {
  const scope = { folderIds: new Set(['a', 'b']), includeRootItems: false }

  it('rejects an item outside it', () => {
    expect(isWithinFolderIdScope('c', scope)).toBe(false)
  })

  /*
   * The case the flag exists for: a root item has no id to match, so without
   * it every root item silently falls outside every scope.
   */
  it('rejects a root item unless the scope includes the root', () => {
    expect(isWithinFolderIdScope(null, scope)).toBe(false)
    expect(isWithinFolderIdScope(null, { ...scope, includeRootItems: true })).toBe(true)
  })
})
