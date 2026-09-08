import { keySummaryProperties } from '@/tools/oci_secrets/outputs'
import { ociSecretsAuthParams, ociSecretsParams } from '@/tools/oci_secrets/params'
import type { OciSecretsListKeysParams, OciSecretsResponse } from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsListKeysTool: InternalToolConfig<
  OciSecretsListKeysParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_list_keys',
  name: 'OCI Secrets List Keys',
  description:
    'Discover keys through the selected vault management endpoint. Requires vault read and key inspect permissions.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    vaultId: ociSecretsParams.vaultId,
    compartmentId: ociSecretsParams.compartmentId,
    limit: ociSecretsParams.limit,
    page: ociSecretsParams.page,
    sortBy: ociSecretsParams.discoverySortBy,
    sortOrder: ociSecretsParams.sortOrder,
    protectionMode: ociSecretsParams.protectionMode,
    algorithm: ociSecretsParams.algorithm,
    length: ociSecretsParams.length,
    curveId: ociSecretsParams.curveId,
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
    nextPage: {
      type: 'string',
      description: 'Opaque continuation token for the next page',
      optional: true,
      nullable: true,
    },
    keys: {
      type: 'array',
      description: 'Key metadata in this page',
      items: { type: 'object', properties: keySummaryProperties },
    },
  },
}
