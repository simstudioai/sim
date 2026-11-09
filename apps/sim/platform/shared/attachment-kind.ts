/** How an uploaded file previews in the composer and transcript, read from its media type. */
export function attachmentKind(mediaType: string): 'image' | 'text' | 'document' {
  if (mediaType.startsWith('image/')) return 'image'
  if (mediaType.startsWith('text/')) return 'text'
  return 'document'
}
