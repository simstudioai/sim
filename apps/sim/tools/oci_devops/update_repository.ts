import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsResponse, OciDevopsUpdateRepositoryParams } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsUpdateRepositoryTool: InternalToolConfig<
  OciDevopsUpdateRepositoryParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_update_repository',
  name: 'OCI DevOps Update Repository',
  description: 'Update Repository in OCI DevOps',
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
    defaultBranch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The default branch of the repository.',
    },
    definedTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Defined tags for this resource. Each key is predefined and scoped to a namespace. See [Resource Tags](/Content/General/Concepts/resourcetags.htm). Example: `{"foo-namespace": {"bar-key": "value"}}`',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Details of the repository. Avoid entering confidential information.',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Simple key-value pair that is applied without any predefined name, type or scope. Exists for cross-compatibility only.  See [Resource Tags](/Content/General/Concepts/resourcetags.htm). Example: `{"bar-key": "value"}`',
    },
    mirrorRepositoryConfig: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'mirrorRepositoryConfig',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the repository. Should be unique within the project.',
    },
    repositoryType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Type of repository. Allowed values: \n`MIRRORED` \n`HOSTED`\n`FORKED`\n Allowed: MIRRORED, HOSTED, FORKED.',
    },
    ifMatch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ETag from a preceding read. Mismatches fail without overwriting concurrent changes.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      repositoryId: params.repositoryId,
      defaultBranch: params.defaultBranch,
      definedTags: params.definedTags,
      description: params.description,
      freeformTags: params.freeformTags,
      mirrorRepositoryConfig: params.mirrorRepositoryConfig,
      name: params.name,
      repositoryType: params.repositoryType,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
