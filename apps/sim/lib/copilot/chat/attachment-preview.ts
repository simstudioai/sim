export function getMothershipAttachmentPreviewUrl(file: {
  key: string
  media_type: string
}): string | undefined {
  if (!file.media_type.startsWith('image/') && !file.media_type.startsWith('video/')) {
    return undefined
  }
  // `preview=1`: this URL only ever backs a rendered thumbnail, so the serve route may
  // substitute a browser-renderable derivative for a format no browser decodes (HEIC).
  return `/api/files/serve/${encodeURIComponent(file.key)}?context=mothership&preview=1`
}
