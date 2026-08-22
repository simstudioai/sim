import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceFileFolderDisplayPath,
  parseWorkspaceFileFolderDisplayPath,
} from '@/lib/workspace-files/folder-display-path'

describe('workspace file folder display paths', () => {
  it('round-trips slashes and backslashes within folder names', () => {
    const segments = ['Finance/Legal', String.raw`FY\2026`, 'Quarterly']
    const path = buildWorkspaceFileFolderDisplayPath(segments)

    expect(path).toBe(String.raw`Finance\/Legal/FY\\2026/Quarterly`)
    expect(parseWorkspaceFileFolderDisplayPath(path)).toEqual(segments)
  })

  it.each(['Finance\\', 'Finance\\x', '/Finance', 'Finance/', 'Finance//Legal'])(
    'rejects malformed display path %s',
    (path) => {
      expect(() => parseWorkspaceFileFolderDisplayPath(path)).toThrow()
    }
  )
})
