import { describe, expect, it } from 'vitest'
import { mergeFileListEntries } from '@/app/workspace/[workspaceId]/files/list-entries'

interface Row {
  id: string
  name: string
  size: number
}

const folder = (id: string, size: number): Row => ({ id, name: id, size })
const file = (id: string, size: number): Row => ({ id, name: id, size })

function merge(input: {
  folders?: Row[]
  files: Row[]
  pinnedFiles?: Row[]
  hasMore: boolean
  pinned?: string[]
  direction?: 'asc' | 'desc'
}) {
  const pinned = new Set(input.pinned ?? [])
  return mergeFileListEntries<Row, Row>({
    folders: input.folders ?? [],
    files: input.files,
    pinnedFiles: input.pinnedFiles ?? [],
    hasMore: input.hasMore,
    isFolderPinned: (row) => pinned.has(row.id),
    isFilePinned: (row) => pinned.has(row.id),
    folderId: (row) => row.id,
    fileId: (row) => row.id,
    folderName: (row) => row.name,
    fileName: (row) => row.name,
    folderKey: (row) => row.size,
    fileKey: (row) => row.size,
    direction: input.direction ?? 'asc',
  }).map((entry) => (entry.kind === 'folder' ? entry.folder.id : entry.file.id))
}

describe('mergeFileListEntries', () => {
  it('withholds a folder that sorts past the last loaded file, so loading more only appends', () => {
    const folders = [folder('F5', 5), folder('F25', 25)]
    const firstPage = [file('a10', 10), file('b20', 20)]
    const secondPage = [file('c30', 30), file('d40', 40)]

    const afterOnePage = merge({ folders, files: firstPage, hasMore: true })
    const afterTwoPages = merge({ folders, files: [...firstPage, ...secondPage], hasMore: false })

    expect(afterOnePage).toEqual(['F5', 'a10', 'b20'])
    expect(afterTwoPages).toEqual(['F5', 'a10', 'b20', 'F25', 'c30', 'd40'])
    expect(afterTwoPages.slice(0, afterOnePage.length)).toEqual(afterOnePage)
  })

  it('shows every folder once the last page is in, including one past every file', () => {
    expect(merge({ folders: [folder('F99', 99)], files: [file('a1', 1)], hasMore: false })).toEqual(
      ['a1', 'F99']
    )
  })

  it('places folders by the descending order the server paged the files in', () => {
    expect(
      merge({
        folders: [folder('F35', 35), folder('F5', 5)],
        files: [file('d40', 40), file('c30', 30), file('b20', 20)],
        hasMore: true,
        direction: 'desc',
      })
    ).toEqual(['d40', 'F35', 'c30', 'b20'])
  })

  it('keeps the server order of the files even where the client would sort them otherwise', () => {
    expect(merge({ folders: [], files: [file('z', 2), file('a', 1)], hasMore: false })).toEqual([
      'z',
      'a',
    ])
  })

  it('leads with pinned rows — a pinned file the pages have not reached, and one they have, once', () => {
    expect(
      merge({
        folders: [folder('F5', 5), folder('Fpin', 50)],
        files: [file('a10', 10), file('pinned20', 20)],
        pinnedFiles: [file('pinned20', 20), file('far90', 90)],
        hasMore: true,
        pinned: ['Fpin', 'pinned20', 'far90'],
      })
    ).toEqual(['pinned20', 'Fpin', 'far90', 'F5', 'a10'])
  })
})
