export function getMothershipAttachmentPreviewUrl(file: {
  key: string
  media_type: string
}): string | undefined {
  if (!file.media_type.startsWith('image/') && !file.media_type.startsWith('video/')) {
    return undefined
  }
  return `/api/files/serve/${encodeURIComponent(file.key)}?context=mothership`
}
