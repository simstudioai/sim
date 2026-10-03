import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsCreateConnectionParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsCreateConnectionTool: InternalToolConfig<
  OciDevopsCreateConnectionParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_create_connection',
  name: 'OCI DevOps Create Connection',
  description: 'Create Connection in OCI DevOps',
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
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The OCID of the DevOps project.',
    },
    connection: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Typed Connection configuration discriminated by connectionType. Supports only documented fields; see the configuration example. secretId is an existing OCI Vault secret OCID, not a plaintext access token. Supported connectionType values: BITBUCKET_SERVER_ACCESS_TOKEN, GITHUB_ACCESS_TOKEN, GITLAB_ACCESS_TOKEN, GITLAB_SERVER_ACCESS_TOKEN, VBS_ACCESS_TOKEN. Example: {"connectionType":"BITBUCKET_SERVER_ACCESS_TOKEN","secretId":"ocid1.vaultsecret.oc1..example","baseUrl":"https://example.com/repository"}',
    },
    retryToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Stable idempotency token (1–64 ASCII characters). Reuse for retries of this action; use a new token for a new action.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      projectId: params.projectId,
      connection: params.connection,
      retryToken: params.retryToken,
    }),
  },
  outputs: ociDevopsOutputs,
}
