import { isSupportedFileType } from '@/lib/file-parsers'
import { getFileExtension, resolveEffectiveMimeType } from '@/lib/uploads/utils/file-utils'

/** Agent reads reuse the parser registry, including plain source files identified by MIME. */
export function workspaceFileTextFormat(file: { name: string; type: string }) {
  const extension = getFileExtension(file.name)
  if (isSupportedFileType(extension)) return extension
  const mediaType = resolveEffectiveMimeType(file.type, file.name).split(';')[0]?.toLowerCase()
  if (
    mediaType?.startsWith('text/') ||
    mediaType === 'application/javascript' ||
    mediaType === 'application/typescript' ||
    mediaType === 'application/json' ||
    mediaType === 'application/xml' ||
    mediaType === 'application/x-ndjson'
  )
    return 'txt'
  return undefined
}
