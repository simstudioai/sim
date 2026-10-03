import { describe, expect, it } from 'vitest'
import { isWithinFolderScope } from '@/lib/folders/scope'

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
