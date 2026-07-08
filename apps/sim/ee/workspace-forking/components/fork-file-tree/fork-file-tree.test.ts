/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { groupForkFilesIntoFolders } from '@/ee/workspace-forking/components/fork-file-tree/fork-file-tree'

describe('groupForkFilesIntoFolders', () => {
  it('groups files under their folder and lifts un-foldered files to the root bucket', () => {
    const { folders, rootFiles } = groupForkFilesIntoFolders([
      { id: 'f1', label: 'b.png', folderId: 'fld-1', folderName: 'Images' },
      { id: 'f2', label: 'a.png', folderId: 'fld-1', folderName: 'Images' },
      { id: 'f3', label: 'root.txt', folderId: null, folderName: null },
      { id: 'f4', label: 'doc.pdf', folderId: 'fld-2', folderName: 'Docs' },
    ])
    // Folders are sorted by name; each folder's files are sorted by label.
    expect(folders.map((folder) => folder.name)).toEqual(['Docs', 'Images'])
    expect(folders[1].files.map((file) => file.label)).toEqual(['a.png', 'b.png'])
    expect(rootFiles.map((file) => file.label)).toEqual(['root.txt'])
  })

  it('treats a file whose folder was deleted (id set, name null) as a root file', () => {
    const { folders, rootFiles } = groupForkFilesIntoFolders([
      { id: 'f1', label: 'orphan.png', folderId: 'fld-deleted', folderName: null },
    ])
    expect(folders).toEqual([])
    expect(rootFiles.map((file) => file.id)).toEqual(['f1'])
  })
})
