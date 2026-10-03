import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsResponse, OciDevopsUpdateBuildRunParams } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsUpdateBuildRunTool: InternalToolConfig<
  OciDevopsUpdateBuildRunParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_update_build_run',
  name: 'OCI DevOps Update Build Run',
  description: 'Update Build Run in OCI DevOps',
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
    buildRunId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique build run identifier.',
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
      description: 'Build run display name. Avoid entering confidential information.',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Simple key-value pair that is applied without any predefined name, type or scope. Exists for cross-compatibility only.  See [Resource Tags](/Content/General/Concepts/resourcetags.htm). Example: `{"bar-key": "value"}`',
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
      buildRunId: params.buildRunId,
      definedTags: params.definedTags,
      displayName: params.displayName,
      freeformTags: params.freeformTags,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
