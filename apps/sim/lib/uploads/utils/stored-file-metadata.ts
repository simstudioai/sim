import { sniffImageContentType } from '@/lib/uploads/utils/validation'

const IMAGE_FILE_EXTENSIONS: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Derives stored image metadata from its bytes rather than trusting a provider's MIME type. */
export function resolveStoredFileMetadata(
  fileName: string,
  declaredMimeType: string,
  buffer: Buffer
): { fileName: string; mimeType: string } {
  if (!declaredMimeType.startsWith('image/')) {
    return { fileName, mimeType: declaredMimeType }
  }

  const mimeType = sniffImageContentType(buffer)
  if (!mimeType) {
    return {
      fileName: `${fileName.replace(/\.[^.]+$/, '')}.bin`,
      mimeType: 'application/octet-stream',
    }
  }

  const extension = IMAGE_FILE_EXTENSIONS[mimeType]
  return {
    fileName: extension ? `${fileName.replace(/\.[^.]+$/, '')}.${extension}` : fileName,
    mimeType,
  }
}
