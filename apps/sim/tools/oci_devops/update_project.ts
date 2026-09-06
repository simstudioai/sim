import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsResponse, OciDevopsUpdateProjectParams } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsUpdateProjectTool: InternalToolConfig<
  OciDevopsUpdateProjectParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_update_project',
  name: 'OCI DevOps Update Project',
  description: 'Update Project in OCI DevOps',
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
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique project identifier.',
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
      description: 'Project description.',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Simple key-value pair that is applied without any predefined name, type or scope. Exists for cross-compatibility only.  See [Resource Tags](/Content/General/Concepts/resourcetags.htm). Example: `{"bar-key": "value"}`',
    },
    notificationConfig: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'notificationConfig',
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
      projectId: params.projectId,
      definedTags: params.definedTags,
      description: params.description,
      freeformTags: params.freeformTags,
      notificationConfig: params.notificationConfig,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
