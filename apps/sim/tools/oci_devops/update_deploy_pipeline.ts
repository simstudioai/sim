import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type {
  OciDevopsResponse,
  OciDevopsUpdateDeployPipelineParams,
} from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsUpdateDeployPipelineTool: InternalToolConfig<
  OciDevopsUpdateDeployPipelineParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_update_deploy_pipeline',
  name: 'OCI DevOps Update Deploy Pipeline',
  description: 'Update Deploy Pipeline in OCI DevOps',
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
    deployPipelineId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique pipeline identifier.',
    },
    definedTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Defined tags for this resource. Each key is predefined and scoped to a namespace. See [Resource Tags](/Content/General/Concepts/resourcetags.htm). Example: `{"foo-namespace": {"bar-key": "value"}}`',
    },
    deployPipelineParameters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'deployPipelineParameters',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional description about the deloyment pipeline.',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Deloyment pipeline display name. Avoid entering confidential information.',
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
      deployPipelineId: params.deployPipelineId,
      definedTags: params.definedTags,
      deployPipelineParameters: params.deployPipelineParameters,
      description: params.description,
      displayName: params.displayName,
      freeformTags: params.freeformTags,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
