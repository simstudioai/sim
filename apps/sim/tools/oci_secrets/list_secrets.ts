import { secretSummaryProperties } from '@/tools/oci_secrets/outputs'
import { ociSecretsAuthParams, ociSecretsParams } from '@/tools/oci_secrets/params'
import type { OciSecretsListSecretsParams, OciSecretsResponse } from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsListSecretsTool: InternalToolConfig<
  OciSecretsListSecretsParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_list_secrets',
  name: 'OCI Secrets List Secrets',
  description: 'List secret metadata in a compartment without retrieving secret contents.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    compartmentId: ociSecretsParams.compartmentId,
    name: ociSecretsParams.name,
    vaultId: { ...ociSecretsParams.vaultId, required: false },
    lifecycleState: ociSecretsParams.lifecycleState,
    limit: ociSecretsParams.limit,
    page: ociSecretsParams.page,
    sortBy: ociSecretsParams.secretSortBy,
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
    secrets: {
      type: 'array',
      description: 'Secret metadata in this page',
      items: { type: 'object', properties: secretSummaryProperties },
    },
  },
}
