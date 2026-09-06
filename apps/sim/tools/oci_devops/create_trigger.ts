import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsCreateTriggerParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsCreateTriggerTool: InternalToolConfig<
  OciDevopsCreateTriggerParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_create_trigger',
  name: 'OCI DevOps Create Trigger',
  description: 'Create Trigger in OCI DevOps',
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
      description: 'The OCID of the DevOps project to which the trigger belongs to.',
    },
    trigger: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Typed Trigger configuration discriminated by triggerSource. Supports only documented fields; see the configuration example. Supported triggerSource values: DEVOPS_CODE_REPOSITORY. Example: {"actions":[{"type":"TRIGGER_BUILD_PIPELINE","buildPipelineId":"ocid1.resource.oc1..example"}],"triggerSource":"DEVOPS_CODE_REPOSITORY"}',
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
      projectId: params.projectId,
      trigger: params.trigger,
      retryToken: params.retryToken,
    }),
  },
  outputs: ociDevopsOutputs,
}
