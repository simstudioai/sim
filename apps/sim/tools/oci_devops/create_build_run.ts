import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsCreateBuildRunParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsCreateBuildRunTool: InternalToolConfig<
  OciDevopsCreateBuildRunParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_create_build_run',
  name: 'OCI DevOps Create Build Run',
  description: 'Create Build Run in OCI DevOps',
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
    buildPipelineId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The OCID of the build pipeline.',
    },
    buildRunArguments: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'buildRunArguments',
    },
    commitInfo: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'commitInfo',
    },
    definedTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Defined tags for this resource. Each key is predefined and scoped to a namespace. See [Resource Tags](/Content/General/Concepts/resourcetags.htm). Example: `{"foo-namespace": {"bar-key": "value"}}`',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Build run display name, which can be renamed and is not necessarily unique. Avoid entering confidential information.',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Simple key-value pair that is applied without any predefined name, type or scope. Exists for cross-compatibility only.  See [Resource Tags](/Content/General/Concepts/resourcetags.htm). Example: `{"bar-key": "value"}`',
    },
    retryToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Stable idempotency token (1–64 ASCII characters). Reuse for retries of this action; use a new token for a new action.',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ETag from a preceding read. Mismatches fail without overwriting concurrent changes.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      buildPipelineId: params.buildPipelineId,
      buildRunArguments: params.buildRunArguments,
      commitInfo: params.commitInfo,
      definedTags: params.definedTags,
      displayName: params.displayName,
      freeformTags: params.freeformTags,
      retryToken: params.retryToken,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
