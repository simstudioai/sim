import { vaultProperties } from '@/tools/oci_secrets/outputs'
import { ociSecretsAuthParams, ociSecretsParams } from '@/tools/oci_secrets/params'
import type { OciSecretsGetVaultParams, OciSecretsResponse } from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsGetVaultTool: InternalToolConfig<
  OciSecretsGetVaultParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_get_vault',
  name: 'OCI Secrets Get Vault',
  description: 'Read vault metadata and service endpoints using vault read permission.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    vaultId: ociSecretsParams.vaultId,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    status: {
      type: 'number',
      description: 'Oracle HTTP response status; 202 means accepted, not completed',
    },
    opcRequestId: {
      type: 'string',
      description: 'Oracle request ID',
      optional: true,
      nullable: true,
    },
    etag: {
      type: 'string',
      description: 'ETag for optimistic concurrency control',
      optional: true,
      nullable: true,
    },
    vault: {
      type: 'json',
      description: 'Vault metadata and endpoints',
      properties: vaultProperties,
    },
  },
}
