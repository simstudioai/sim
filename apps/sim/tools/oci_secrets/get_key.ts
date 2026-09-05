import { keyProperties } from '@/tools/oci_secrets/outputs'
import { ociSecretsAuthParams, ociSecretsParams } from '@/tools/oci_secrets/params'
import type { OciSecretsGetKeyParams, OciSecretsResponse } from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsGetKeyTool: InternalToolConfig<OciSecretsGetKeyParams, OciSecretsResponse> =
  {
    id: 'oci_secrets_get_key',
    name: 'OCI Secrets Get Key',
    description:
      'Read key metadata through its vault management endpoint. Requires vault read and key read permissions.',
    version: '1.0.0',
    oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
    params: {
      ...ociSecretsAuthParams,
      vaultId: ociSecretsParams.vaultId,
      keyId: ociSecretsParams.keyId,
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
      key: {
        type: 'json',
        description: 'Key metadata and shape',
        properties: keyProperties,
      },
    },
  }
