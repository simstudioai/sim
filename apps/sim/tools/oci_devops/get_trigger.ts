import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsGetTriggerParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsGetTriggerTool: InternalToolConfig<
  OciDevopsGetTriggerParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_get_trigger',
  name: 'OCI DevOps Get Trigger',
  description: 'Get Trigger in OCI DevOps',
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
    triggerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique trigger identifier.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      triggerId: params.triggerId,
    }),
  },
  outputs: ociDevopsOutputs,
}
