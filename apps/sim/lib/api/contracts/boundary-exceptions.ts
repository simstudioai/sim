export const mediaToolRawFlowExceptions = [
  {
    path: '/api/tools/image',
    method: 'GET',
    boundary: 'external-origin-binary-proxy',
    reason:
      'Proxies a validated external image origin and returns the upstream binary image bytes.',
  },
  {
    path: '/api/proxy/tts/stream',
    method: 'POST',
    boundary: 'stream',
    reason: 'Streams audio bytes from ElevenLabs through a readable stream with audio headers.',
  },
  {
    path: '/api/files/upload',
    method: 'POST',
    boundary: 'multipart',
    reason: 'Accepts browser multipart/form-data file uploads instead of a JSON body.',
  },
  {
    path: '/api/files/multipart',
    method: 'POST',
    boundary: 'multipart-signed-url',
    reason: 'Coordinates cloud multipart upload tokens and signed part URLs.',
  },
  {
    path: '/api/files/presigned',
    method: 'POST',
    boundary: 'signed-url',
    reason: 'Returns provider-specific signed upload URLs and upload headers.',
  },
  {
    path: '/api/files/presigned/batch',
    method: 'POST',
    boundary: 'signed-url',
    reason: 'Returns batches of provider-specific signed upload URLs and upload headers.',
  },
  {
    path: '/api/files/serve/[...path]',
    method: 'GET',
    boundary: 'binary',
    reason: 'Serves stored file bytes with content-specific response headers.',
  },
] as const
