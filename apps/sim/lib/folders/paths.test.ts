import { describe, expect, it } from 'vitest'
import {
  v2CreateFolderBodySchema,
  v2DeleteFolderQuerySchema,
  v2ListFoldersQuerySchema,
  v2RelocateFolderBodySchema,
} from '@/lib/api/contracts/v2/shared'
import {
  buildFolderPath,
  buildFolderPathIndex,
  encodeFolderPathSegment,
  FolderPathError,
  MAX_FOLDER_PATH_SEGMENTS,
  parseFolderPath,
  ROOT_FOLDER_PATH,
} from '@/lib/folders/paths'

describe('canonical folder paths', () => {
  it('round-trips exact names without case or Unicode normalization', () => {
    const segments = ['Reports', 'Q1 / 100%', 'é', '.', '..']
    const path = buildFolderPath(segments)

    expect(path).toBe('/Reports/Q1%20%2F%20100%25/e%CC%81/%2E/%2E%2E')
    expect(parseFolderPath(path)).toEqual(segments)
    expect(buildFolderPath([])).toBe(ROOT_FOLDER_PATH)
    expect(encodeFolderPathSegment('é')).not.toBe(encodeFolderPathSegment('é'))
  })

  it.each([
    '',
    'Reports',
    '/Reports/',
    '/Reports//Q1',
    '/Reports Q1',
    '/R%C3%A9sum%c3%a9',
    '/%52eports',
    '/.',
    '/..',
    '/%E0%A4%A',
  ])('rejects noncanonical path %s', (path) => {
    expect(() => parseFolderPath(path)).toThrow()
  })

  it.each(['/apitest_%00x', '/%00', '/Reports/Q1%00'])(
    'rejects a percent-encoded NUL in path %s',
    (path) => {
      expect(() => parseFolderPath(path)).toThrow(FolderPathError)
    }
  )

  it('rejects a NUL in a folder name before it can be encoded into a path', () => {
    expect(() => encodeFolderPathSegment('apitest_\u0000x')).toThrow(FolderPathError)
    expect(() => buildFolderPath(['apitest_\u0000x'])).toThrow(FolderPathError)
  })

  it('builds a bidirectional index and rejects corrupt hierarchies', () => {
    const rows = [
      { id: 'a', name: 'Reports', parentId: null },
      { id: 'b', name: 'Q1', parentId: 'a' },
    ]
    const index = buildFolderPathIndex(rows)

    expect(index.pathById.get('b')).toBe('/Reports/Q1')
    expect(index.idByPath.get('/Reports/Q1')).toBe('b')
    expect(
      buildFolderPathIndex([
        { id: 'upper', name: 'Reports', parentId: null },
        { id: 'lower', name: 'reports', parentId: null },
      ]).idByPath
    ).toEqual(
      new Map([
        ['/Reports', 'upper'],
        ['/reports', 'lower'],
      ])
    )
    expect(() =>
      buildFolderPathIndex([
        { id: 'a', name: 'Reports', parentId: null },
        { id: 'b', name: 'Reports', parentId: null },
      ])
    ).toThrow('duplicate path')
    expect(() => buildFolderPathIndex([{ id: 'a', name: 'Reports', parentId: 'missing' }])).toThrow(
      'missing folder'
    )
    expect(() =>
      buildFolderPathIndex([
        { id: 'a', name: 'A', parentId: 'b' },
        { id: 'b', name: 'B', parentId: 'a' },
      ])
    ).toThrow('cycle')
  })

  it('keeps slashes inside names as one segment in every resource folder index', () => {
    const index = buildFolderPathIndex([
      { id: 'legal', name: 'Finance/Legal', parentId: null },
      { id: 'quarterly', name: 'Quarterly', parentId: 'legal' },
    ])

    expect(index.pathById.get('legal')).toBe('/Finance%2FLegal')
    expect(index.pathById.get('quarterly')).toBe('/Finance%2FLegal/Quarterly')
    expect(index.idByPath.get('/Finance%2FLegal')).toBe('legal')
  })

  it('enforces segment and byte limits', () => {
    expect(() =>
      buildFolderPath(Array.from({ length: MAX_FOLDER_PATH_SEGMENTS + 1 }, () => 'x'))
    ).toThrow('segments')
    expect(() => buildFolderPath(['x'.repeat(4096)])).toThrow('bytes')
  })

  it('keeps public folder mutations path-only and rejects the virtual root', () => {
    expect(v2ListFoldersQuerySchema.parse({ workspaceId: 'workspace-1', parentPath: '/' })).toEqual(
      {
        workspaceId: 'workspace-1',
        parentPath: '/',
        sortBy: 'name',
        sortOrder: 'asc',
      }
    )
    expect(
      v2CreateFolderBodySchema.safeParse({ workspaceId: 'workspace-1', path: '/' }).success
    ).toBe(false)
    expect(
      v2CreateFolderBodySchema.safeParse({
        workspaceId: 'workspace-1',
        path: '/Reports',
        folderId: 'internal-id',
      }).success
    ).toBe(false)
    expect(
      v2RelocateFolderBodySchema.safeParse({
        workspaceId: 'workspace-1',
        path: '/Reports',
        destinationPath: '/Reports',
      }).success
    ).toBe(false)
    expect(
      v2DeleteFolderQuerySchema.parse({
        workspaceId: 'workspace-1',
        path: '/Reports',
        recursive: 'true',
      }).recursive
    ).toBe(true)
    expect(
      v2DeleteFolderQuerySchema.parse({ workspaceId: 'workspace-1', path: '/Reports' }).recursive
    ).toBe(false)
  })
})
