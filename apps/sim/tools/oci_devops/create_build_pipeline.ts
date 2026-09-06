import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type {
  OciDevopsCreateBuildPipelineParams,
  OciDevopsResponse,
} from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsCreateBuildPipelineTool: InternalToolConfig<
  OciDevopsCreateBuildPipelineParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_create_build_pipeline',
  name: 'OCI DevOps Create Build Pipeline',
  description: 'Create Build Pipeline in OCI DevOps',
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
    buildPipelineParameters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'buildPipelineParameters',
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
      description: 'Optional description about the build pipeline.',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Build pipeline display name. Avoid entering confidential information.',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Simple key-value pair that is applied without any predefined name, type or scope. Exists for cross-compatibility only.  See [Resource Tags](/Content/General/Concepts/resourcetags.htm). Example: `{"bar-key": "value"}`',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The OCID of the DevOps project.',
    },
    retryToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Stable idempotency token (1–64 ASCII characters). Reuse for retries of this action; use a new token for a new action.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      buildPipelineParameters: params.buildPipelineParameters,
      definedTags: params.definedTags,
      description: params.description,
      displayName: params.displayName,
      freeformTags: params.freeformTags,
      projectId: params.projectId,
      retryToken: params.retryToken,
    }),
  },
  outputs: ociDevopsOutputs,
}
