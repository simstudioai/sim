import { parseAsString } from 'nuqs/server'

/** Null selects the shared root, its listing, and the first page respectively. */
export const publicFolderParsers = {
  folderId: parseAsString,
  fileId: parseAsString,
  cursor: parseAsString,
} as const

export const publicFolderUrlKeys = {
  history: 'push',
  clearOnDefault: true,
  urlKeys: { folderId: 'folder-id', fileId: 'file-id' },
} as const
