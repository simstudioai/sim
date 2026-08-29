import { getErrorMessage } from '@sim/utils/errors'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  consumeOrCancelBody,
  isPayloadSizeLimitError,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'

export const MAX_REMOTE_IMAGE_BYTES = 25 * 1024 * 1024

export class RemoteImageFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'RemoteImageFetchError'
  }
}

export interface FetchRemoteImageResult {
  buffer: Buffer
  contentType: string
}

export async function fetchRemoteImage(
  imageUrl: string,
  signal?: AbortSignal
): Promise<FetchRemoteImageResult> {
  signal?.throwIfAborted()
  const validation = await validateUrlWithDNS(imageUrl, 'imageUrl', 'contentFetch')
  if (!validation.isValid) {
    throw new RemoteImageFetchError(validation.error || 'Invalid image URL', 403)
  }

  try {
    const response = await secureFetchWithPinnedIP(imageUrl, validation.resolvedIP, {
      profile: 'contentFetch',
      method: 'GET',
      maxResponseBytes: MAX_REMOTE_IMAGE_BYTES,
      signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'image/webp,image/avif,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://sim.ai/',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
      },
    })

    if (!response.ok) {
      await consumeOrCancelBody(response)
      throw new RemoteImageFetchError(
        `Failed to fetch image: ${response.statusText}`,
        response.status
      )
    }

    const buffer = await readResponseToBufferWithLimit(response, {
      maxBytes: MAX_REMOTE_IMAGE_BYTES,
      label: 'image proxy response',
      signal,
    })
    if (buffer.length === 0) throw new RemoteImageFetchError('Empty image received', 404)

    return {
      buffer,
      contentType: response.headers.get('content-type') || 'image/jpeg',
    }
  } catch (error) {
    if (error instanceof RemoteImageFetchError) throw error
    throw new RemoteImageFetchError(
      `Failed to proxy image: ${getErrorMessage(error)}`,
      isPayloadSizeLimitError(error) ? 413 : 500,
      { cause: error }
    )
  }
}
