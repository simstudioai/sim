import type { BitbucketGetFileParams, BitbucketToolResponse } from '@/tools/bitbucket/types'
import {
  assertBitbucketResponseOk,
  BITBUCKET_API_BASE,
  BITBUCKET_DEFAULT_MAX_CHARACTERS,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_RAW_TRANSFER_MAX_BYTES,
  BITBUCKET_READ_RETRY,
  BITBUCKET_REPOSITORY_PARAMS,
  bitbucketHeaders,
  bitbucketHeadRange,
  bitbucketJson,
  bitbucketMaxCharacters,
  bitbucketRawHead,
  bitbucketRepositoryPath,
  encodeBitbucketRepositoryPath,
  encodeBitbucketSegment,
  normalizeBitbucketFileMetadata,
} from '@/tools/bitbucket/utils'
import { requireBitbucketSha1 } from '@/tools/bitbucket/validation'
import type { ToolConfig } from '@/tools/types'

interface BitbucketFileOutput {
  content: string | null
  binary: boolean | null
  truncated: boolean | null
  returnedBytes: number
  fullBytes: number | null
  contentType: string | null
}

function fileUrl(params: BitbucketGetFileParams, metadata = false): string {
  const commit = requireBitbucketSha1(params.commit, 'commit')
  const url = `${BITBUCKET_API_BASE}${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/src/${encodeBitbucketSegment(commit, 'commit')}/${encodeBitbucketRepositoryPath(params.path)}`
  return metadata ? `${url}?format=meta` : url
}

export const bitbucketGetFileTool: ToolConfig<
  BitbucketGetFileParams,
  BitbucketToolResponse<BitbucketFileOutput>
> = {
  id: 'bitbucket_get_file',
  name: 'Bitbucket Get File',
  description: 'Read bounded UTF-8 text from a file at a full repository commit SHA-1',
  version: '1.0.0',
  oauth: { required: true, provider: 'bitbucket', requiredScopes: ['repository'] },
  params: {
    ...BITBUCKET_REPOSITORY_PARAMS,
    commit: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Full 40-character commit SHA-1',
    },
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository-relative file path',
    },
    maxCharacters: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum text characters to return (1-500000)',
      default: BITBUCKET_DEFAULT_MAX_CHARACTERS,
    },
  },
  directExecution: async (params, signal) => {
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
  },
  request: {
    url: (params) => fileUrl(params),
    method: 'GET',
    headers: (params) =>
      bitbucketHeaders(params.accessToken, {
        json: false,
        range: bitbucketHeadRange(params.maxCharacters),
      }),
    retry: BITBUCKET_READ_RETRY,
    stripAuthOnRedirect: true,
  },
  transformResponse: async () => {
    throw new Error('Bitbucket file reads require the metadata preflight direct execution path')
  },
  outputs: {
    content: {
      type: 'string',
      description: 'Bounded UTF-8 file text; null for binary content',
      nullable: true,
    },
    binary: {
      type: 'boolean',
      description: 'Whether documented metadata identifies binary content; null when unknown',
      nullable: true,
    },
    truncated: {
      type: 'boolean',
      description: 'Whether later content was omitted; null when binary size is unknown',
      nullable: true,
    },
    returnedBytes: { type: 'number', description: 'Provider bytes read for the returned file' },
    fullBytes: {
      type: 'number',
      description: 'Full file byte size when reported',
      nullable: true,
    },
    contentType: { type: 'string', description: 'Response MIME type', nullable: true },
  },
  errorExtractor: BITBUCKET_ERROR_EXTRACTOR,
}
