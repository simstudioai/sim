import type { BitbucketGetFileParams, BitbucketToolResponse } from '@/tools/bitbucket/types'
import {
  BITBUCKET_API_BASE,
  BITBUCKET_DEFAULT_MAX_CHARACTERS,
  BITBUCKET_ERROR_EXTRACTOR,
  BITBUCKET_REPOSITORY_PARAMS,
  bitbucketRepositoryPath,
  encodeBitbucketRepositoryPath,
  encodeBitbucketSegment,
} from '@/tools/bitbucket/utils'
import { requireBitbucketSha1 } from '@/tools/bitbucket/validation'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

interface BitbucketFileOutput {
  content: string | null
  binary: boolean | null
  truncated: boolean | null
  returnedBytes: number
  fullBytes: number | null
  contentType: string | null
}

export function fileUrl(params: BitbucketGetFileParams, metadata = false): string {
  const commit = requireBitbucketSha1(params.commit, 'commit')
  const url = `${BITBUCKET_API_BASE}${bitbucketRepositoryPath(params.workspaceSlug, params.repoSlug)}/src/${encodeBitbucketSegment(commit, 'commit')}/${encodeBitbucketRepositoryPath(params.path)}`
  return metadata ? `${url}?format=meta` : url
}

export const bitbucketGetFileTool: InternalToolConfig<
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
  operation: {
    input: createInternalToolOperationInput,
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
