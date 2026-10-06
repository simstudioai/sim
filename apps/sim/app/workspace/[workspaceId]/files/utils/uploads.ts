import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import {
  SUPPORTED_ARCHIVE_EXTENSIONS,
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_CODE_EXTENSIONS,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
} from '@/lib/uploads/utils/validation'

const FILE_UPLOAD_EXTENSIONS = [
  ...SUPPORTED_DOCUMENT_EXTENSIONS,
  ...SUPPORTED_CODE_EXTENSIONS,
  ...SUPPORTED_AUDIO_EXTENSIONS,
  ...SUPPORTED_VIDEO_EXTENSIONS,
  ...SUPPORTED_IMAGE_EXTENSIONS,
  ...SUPPORTED_ARCHIVE_EXTENSIONS,
] as const

export const hasExternalFiles = (dataTransfer: DataTransfer): boolean =>
  dataTransfer.types.includes('Files')

/** Includes canonical extensionless source filenames accepted by the file browser. */
export function isSupportedFileUpload(name: string): boolean {
  const extension = getFileExtension(name)
  return (
    name.toLowerCase() === 'dockerfile' ||
    name.toLowerCase() === 'makefile' ||
    FILE_UPLOAD_EXTENSIONS.some((supported) => supported === extension)
  )
}
