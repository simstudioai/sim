/** Inline image limits shared by Assistant upload, preview, and model preparation. */
export const ASSISTANT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const ASSISTANT_IMAGE_MAX_COUNT = 5
export const ASSISTANT_IMAGE_MAX_TOTAL_BYTES = ASSISTANT_IMAGE_MAX_BYTES * ASSISTANT_IMAGE_MAX_COUNT
export const ASSISTANT_IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const
export const ASSISTANT_IMAGE_ACCEPT_ATTRIBUTE = ASSISTANT_IMAGE_CONTENT_TYPES.join(',')

export function isAssistantImageType(contentType: string): boolean {
  return ASSISTANT_IMAGE_CONTENT_TYPES.some((type) => type === contentType)
}
