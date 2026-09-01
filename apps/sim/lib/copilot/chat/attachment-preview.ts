export function getMothershipAttachmentPreviewUrl(file: {
  key: string
  media_type: string
}): string | undefined {
  const isImage = file.media_type.startsWith('image/')
  if (!isImage && !file.media_type.startsWith('video/')) {
    return undefined
  }
  // `preview=1` only for images: this URL backs a rendered thumbnail, so the serve route
  // may substitute a browser-renderable derivative for a format no browser decodes (HEIC).
  // A video has no derivative path, so asking would only spend a brand sniff per request.
  const preview = isImage ? '&preview=1' : ''
  return `/api/files/serve/${encodeURIComponent(file.key)}?context=mothership${preview}`
}
