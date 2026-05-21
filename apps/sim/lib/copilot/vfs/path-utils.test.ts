/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  canonicalWorkspaceFilePath,
  decodeVfsPathSegments,
  encodeVfsPathSegments,
} from '@/lib/copilot/vfs/path-utils'

describe('VFS path utilities', () => {
  it('round trips encoded nested path segments', () => {
    const segments = ['Reports', 'Q4 Report (Final)', 'sales/east.csv']

    const encoded = encodeVfsPathSegments(segments)

    expect(encoded).toBe('Reports/Q4%20Report%20(Final)/sales%2Feast.csv')
    expect(decodeVfsPathSegments(encoded)).toEqual(segments)
  })

  it('builds canonical workspace file leaf paths', () => {
    expect(
      canonicalWorkspaceFilePath({
        folderPath: 'Reports/Q4 Report (Final)',
        name: 'sales/east.csv',
      })
    ).toBe('files/Reports/Q4%20Report%20(Final)/sales%2Feast.csv')
  })
})
