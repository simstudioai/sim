import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { fileUrl } from '@/tools/bitbucket/get_file'
import type { BitbucketGetFileParams } from '@/tools/bitbucket/types'
import {
  assertBitbucketResponseOk,
  BITBUCKET_RAW_TRANSFER_MAX_BYTES,
  bitbucketHeaders,
  bitbucketHeadRange,
  bitbucketJson,
  bitbucketMaxCharacters,
  bitbucketRawHead,
  normalizeBitbucketFileMetadata,
} from '@/tools/bitbucket/utils'

export const executeBitbucketGetFileOperation: InternalToolOperationImplementation<
  BitbucketGetFileParams
> = async (params, signal) => {
  bitbucketMaxCharacters(params.maxCharacters)
  const { secureBitbucketRead } = await import('@/tools/bitbucket/utils.server')
  const metadataResponse = await secureBitbucketRead(
    fileUrl(params, true),
    bitbucketHeaders(params.accessToken),
    256 * 1024,
    { signal }
  )
  await assertBitbucketResponseOk(metadataResponse)
  const metadata = normalizeBitbucketFileMetadata(await bitbucketJson(metadataResponse))
  if (metadata.isBinary === true) {
    return {
      success: true,
      output: {
        content: null,
        binary: true,
        truncated: metadata.size === null ? null : metadata.size > 0,
        returnedBytes: 0,
        fullBytes: metadata.size,
        contentType: null,
      },
    }
  }

  const rawResponse = await secureBitbucketRead(
    fileUrl(params),
    bitbucketHeaders(params.accessToken, {
      json: false,
      range: bitbucketHeadRange(params.maxCharacters),
    }),
    BITBUCKET_RAW_TRANSFER_MAX_BYTES,
    { stripAuthOnRedirect: true, signal }
  )
  await assertBitbucketResponseOk(rawResponse)
  const raw = await bitbucketRawHead(rawResponse, params.maxCharacters, metadata.isBinary)
  const fullBytes = raw.fullBytes ?? metadata.size
  return {
    success: true,
    output: {
      ...raw,
      truncated:
        raw.binary === true && raw.truncated === null && fullBytes !== null
          ? fullBytes > 0
          : raw.truncated,
      fullBytes,
    },
  }
}
