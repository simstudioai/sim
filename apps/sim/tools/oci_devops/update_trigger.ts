import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsResponse, OciDevopsUpdateTriggerParams } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsUpdateTriggerTool: InternalToolConfig<
  OciDevopsUpdateTriggerParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_update_trigger',
  name: 'OCI DevOps Update Trigger',
  description: 'Update Trigger in OCI DevOps',
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
    trigger: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Typed Trigger configuration discriminated by triggerSource. Supports only documented fields; see the configuration example. Supported triggerSource values: BITBUCKET_CLOUD, BITBUCKET_SERVER, DEVOPS_CODE_REPOSITORY, GITHUB, GITLAB_SERVER, GITLAB, VBS. Example: {"triggerSource":"BITBUCKET_CLOUD"}',
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
      triggerId: params.triggerId,
      trigger: params.trigger,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
