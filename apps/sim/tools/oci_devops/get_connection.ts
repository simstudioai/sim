import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsGetConnectionParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsGetConnectionTool: InternalToolConfig<
  OciDevopsGetConnectionParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_get_connection',
  name: 'OCI DevOps Get Connection',
  description: 'Get Connection in OCI DevOps',
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
    connectionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique connection identifier.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      connectionId: params.connectionId,
    }),
  },
  outputs: ociDevopsOutputs,
}
