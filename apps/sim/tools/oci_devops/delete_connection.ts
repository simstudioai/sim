import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsDeleteConnectionParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsDeleteConnectionTool: InternalToolConfig<
  OciDevopsDeleteConnectionParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_delete_connection',
  name: 'OCI DevOps Delete Connection',
  description: 'Delete Connection in OCI DevOps',
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
      connectionId: params.connectionId,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
