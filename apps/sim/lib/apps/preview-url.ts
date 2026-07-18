export function buildAppPreviewUrl(params: {
  appPublicOrigin: string
  sessionId: string
  channelNonce: string
  parentOrigin: string
}): string {
  const previewUrl = new URL(
    `/__sim/preview/${encodeURIComponent(params.sessionId)}/${encodeURIComponent(params.channelNonce)}/`,
    params.appPublicOrigin
  )
  previewUrl.searchParams.set('parentOrigin', params.parentOrigin)
  return previewUrl.toString()
}
