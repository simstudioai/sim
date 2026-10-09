import {
  MAX_UPLOAD_DIRECTORIES,
  MAX_UPLOAD_SELECTION_ENTRIES,
  validateUploadDirectories,
  validateUploadPath,
} from '@/lib/workspace-files/upload-directory-plan'

export interface UploadSelection {
  directories: string[][]
  files: { file: File; path: string[] }[]
}

function createSelection() {
  const selection: UploadSelection = { directories: [], files: [] }
  const directories = new Set<string>()
  const filePaths = new Set<string>()
  const checkCount = () => {
    if (selection.files.length + directories.size > MAX_UPLOAD_SELECTION_ENTRIES) {
      throw new Error(`Select at most ${MAX_UPLOAD_SELECTION_ENTRIES} files and folders at a time`)
    }
  }
  const addDirectory = (path: string[]) => {
    validateUploadPath(path)
    const key = JSON.stringify(path)
    if (directories.has(key)) return
    if (path.length > 1 && filePaths.has(key)) {
      throw new Error('A selected file and folder have the same path')
    }
    directories.add(key)
    if (directories.size > MAX_UPLOAD_DIRECTORIES) {
      throw new Error(`Select at most ${MAX_UPLOAD_DIRECTORIES} folders at a time`)
    }
    checkCount()
    selection.directories.push(path)
  }
  return {
    selection,
    addDirectory,
    addFile(file: File, path: string[]) {
      if (path.at(-1) !== file.name)
        throw new Error(`The selected path does not match "${file.name}"`)
      for (let depth = 1; depth < path.length; depth++) addDirectory(path.slice(0, depth))
      const key = JSON.stringify(path)
      if (path.length > 1 && (filePaths.has(key) || directories.has(key))) {
        throw new Error(`The selection contains the same path more than once: ${path.join('/')}`)
      }
      filePaths.add(key)
      selection.files.push({ file, path })
      checkCount()
    },
    finish() {
      if (selection.directories.length > 0) validateUploadDirectories(selection.directories)
      return selection
    },
  }
}

/** Reads directory-picker paths while preserving ordinary file-picker behavior. */
export function selectionFromFiles(files: readonly File[]): UploadSelection {
  const builder = createSelection()
  for (const file of files) {
    const path = file.webkitRelativePath ? file.webkitRelativePath.split('/') : [file.name]
    builder.addFile(file, path)
  }
  return builder.finish()
}

function readEntry<T>(
  signal: AbortSignal,
  read: (resolve: (value: T) => void, reject: (error: DOMException) => void) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    signal.throwIfAborted()
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    const settle = (callback: () => void) => {
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    try {
      read(
        (value) => settle(() => resolve(value)),
        (error) => settle(() => reject(error))
      )
    } catch (error) {
      settle(() => reject(error))
    }
  })
}

/** Captures native drag entries synchronously and drains directory readers until canceled. */
export async function selectionFromDrop(
  dataTransfer: DataTransfer,
  signal: AbortSignal
): Promise<UploadSelection> {
  signal.throwIfAborted()
  if (dataTransfer.items.length === 0) return selectionFromFiles(Array.from(dataTransfer.files))
  const roots = Array.from(dataTransfer.items)
    .filter((item) => item.kind === 'file')
    .map((item) => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile() }))
  const builder = createSelection()
  const rootDirectories = new Set<string>()
  for (const root of roots) {
    if (!root.entry?.isDirectory) continue
    if (rootDirectories.has(root.entry.name)) {
      throw new Error(
        `Upload folders named "${root.entry.name}" in separate batches to keep their contents separate`
      )
    }
    rootDirectories.add(root.entry.name)
  }

  const visit = async (entry: FileSystemEntry, parent: string[]): Promise<void> => {
    signal.throwIfAborted()
    const path = [...parent, entry.name]
    if (entry.isDirectory) {
      builder.addDirectory(path)
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      while (true) {
        const children = await readEntry<FileSystemEntry[]>(signal, (resolve, reject) =>
          reader.readEntries(resolve, reject)
        )
        signal.throwIfAborted()
        if (children.length === 0) break
        for (const child of children) await visit(child, path)
      }
    } else if (entry.isFile) {
      const file = await readEntry<File>(signal, (resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject)
      )
      signal.throwIfAborted()
      builder.addFile(file, path)
    } else {
      throw new Error(
        `Cannot read "${path.join('/')}". Select it again using Upload files or Upload folder.`
      )
    }
  }

  for (const root of roots) {
    signal.throwIfAborted()
    if (root.entry) await visit(root.entry, [])
    else if (root.file)
      builder.addFile(
        root.file,
        root.file.webkitRelativePath ? root.file.webkitRelativePath.split('/') : [root.file.name]
      )
    else
      throw new Error(
        'A dropped item could not be read. Select it again using Upload files or Upload folder.'
      )
  }
  return builder.finish()
}
