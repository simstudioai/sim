import type { FileReference, UserFile } from '@/executor/types'

/**
 * Transform FileReference to UserFile for user-facing contexts
 */
export function fileReferenceToUserFile(fileRef: FileReference): UserFile {
  return {
    name: fileRef.name,
    url: fileRef.directUrl!,
    size: fileRef.size,
    type: fileRef.type,
    uploadedAt: fileRef.uploadedAt,
  }
}

/**
 * Transform array of FileReference to UserFile array
 */
export function fileReferencesToUserFiles(fileRefs: FileReference[]): UserFile[] {
  return fileRefs.map(fileReferenceToUserFile)
}

/**
 * Transform any object containing FileReference arrays to UserFile arrays for user-facing contexts
 */
export function transformFilesForUserContext(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => transformFilesForUserContext(item))
  }

  const transformed = { ...obj }

  // Transform files array if present
  if (transformed.files && Array.isArray(transformed.files)) {
    // Check if this looks like a FileReference array
    if (transformed.files.length > 0 && transformed.files[0]?.directUrl !== undefined) {
      transformed.files = fileReferencesToUserFiles(transformed.files)
    }
  }

  // Recursively transform nested objects
  for (const key in transformed) {
    if (Object.hasOwn(transformed, key) && key !== 'files') {
      transformed[key] = transformFilesForUserContext(transformed[key])
    }
  }

  return transformed
}
