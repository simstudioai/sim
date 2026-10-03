import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsResponse, OciDevopsUpdateConnectionParams } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsUpdateConnectionTool: InternalToolConfig<
  OciDevopsUpdateConnectionParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_update_connection',
  name: 'OCI DevOps Update Connection',
  description: 'Update Connection in OCI DevOps',
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
    connection: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Typed Connection configuration discriminated by connectionType. Supports only documented fields; see the configuration example. secretId is an existing OCI Vault secret OCID, not a plaintext access token. Supported connectionType values: BITBUCKET_SERVER_ACCESS_TOKEN, GITHUB_ACCESS_TOKEN, GITLAB_ACCESS_TOKEN, GITLAB_SERVER_ACCESS_TOKEN, VBS_ACCESS_TOKEN. Example: {"connectionType":"BITBUCKET_SERVER_ACCESS_TOKEN"}',
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
      connection: params.connection,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
