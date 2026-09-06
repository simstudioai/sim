import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsCreateProjectParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsCreateProjectTool: InternalToolConfig<
  OciDevopsCreateProjectParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_create_project',
  name: 'OCI DevOps Create Project',
  description: 'Create Project in OCI DevOps',
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
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The OCID of the compartment where the project is created.',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project name (case-sensitive).',
    },
    notificationConfig: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'notificationConfig',
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
      compartmentId: params.compartmentId,
      definedTags: params.definedTags,
      description: params.description,
      freeformTags: params.freeformTags,
      name: params.name,
      notificationConfig: params.notificationConfig,
      retryToken: params.retryToken,
    }),
  },
  outputs: ociDevopsOutputs,
}
