import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsListCommitsParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsListCommitsTool: InternalToolConfig<
  OciDevopsListCommitsParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_list_commits',
  name: 'OCI DevOps List Commits',
  description: 'List Commits in OCI DevOps',
  version: '1.0.0',
  params: {
    oauthCredential: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'OCI API-key service-account credential ID',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'OCI region; defaults to the credential region',
    },
    repositoryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique repository identifier.',
    },
    refName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A filter to return only resources that match the given reference name.',
    },
    excludeRefName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A filter to exclude commits that match the given reference name.',
    },
    filePath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A filter to return only commits that affect any of the specified paths.',
    },
    timestampGreaterThanOrEqualTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A filter to return commits only created after the specified timestamp value.',
    },
    timestampLessThanOrEqualTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A filter to return commits only created before the specified timestamp value.',
    },
    commitMessage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A filter to return any commits that contains the given message.',
    },
    authorName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A filter to return any commits that are pushed by the requested author.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The maximum number of items to return.',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The page token representing the page at which to start retrieving results. This is usually retrieved from a previous list call.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      repositoryId: params.repositoryId,
      refName: params.refName,
      excludeRefName: params.excludeRefName,
      filePath: params.filePath,
      timestampGreaterThanOrEqualTo: params.timestampGreaterThanOrEqualTo,
      timestampLessThanOrEqualTo: params.timestampLessThanOrEqualTo,
      commitMessage: params.commitMessage,
      authorName: params.authorName,
      limit: params.limit,
      page: params.page,
    }),
  },
  outputs: ociDevopsOutputs,
}
