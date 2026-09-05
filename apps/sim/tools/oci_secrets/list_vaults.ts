import { vaultSummaryProperties } from '@/tools/oci_secrets/outputs'
import { ociSecretsAuthParams, ociSecretsParams } from '@/tools/oci_secrets/params'
import type { OciSecretsListVaultsParams, OciSecretsResponse } from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsListVaultsTool: InternalToolConfig<
  OciSecretsListVaultsParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_list_vaults',
  name: 'OCI Secrets List Vaults',
  description: 'Discover vaults in a compartment using vault inspect permission.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    compartmentId: ociSecretsParams.compartmentId,
    limit: ociSecretsParams.limit,
    page: ociSecretsParams.page,
    sortBy: ociSecretsParams.discoverySortBy,
    sortOrder: ociSecretsParams.sortOrder,
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
    vaults: {
      type: 'array',
      description: 'Vault metadata in this page',
      items: { type: 'object', properties: vaultSummaryProperties },
    },
  },
}
