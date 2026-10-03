import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsResponse, OciDevopsValidateConnectionParams } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsValidateConnectionTool: InternalToolConfig<
  OciDevopsValidateConnectionParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_validate_connection',
  name: 'OCI DevOps Validate Connection',
  description: 'Validate Connection in OCI DevOps',
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
    retryToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Stable idempotency token (1–64 ASCII characters). Reuse for retries of this action; use a new token for a new action.',
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
      retryToken: params.retryToken,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
