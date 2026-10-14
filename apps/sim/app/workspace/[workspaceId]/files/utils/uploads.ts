import { toast } from '@sim/emcn'

export const hasExternalFiles = (dataTransfer: DataTransfer): boolean =>
  dataTransfer.types.includes('Files')

/** Rejects directory drops while retaining arbitrary file uploads. */
export function getDroppedFiles(dataTransfer: DataTransfer): File[] {
  if (dataTransfer.items.length === 0) return Array.from(dataTransfer.files)
  const files: File[] = []
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== 'file') continue
    const entry = item.webkitGetAsEntry?.()
    if (entry?.isDirectory) {
      toast.error(`Cannot upload the folder "${entry.name}"`, {
        description: 'Create a folder in Files, then upload the files inside it.',
      })
      continue
    }
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  return files
}
