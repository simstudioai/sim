import {
  INSTANCE_CONFIGURATION_OUTPUT_PROPERTIES,
  type OciComputeResponse,
  type OciComputeUpdateInstanceConfigurationParams,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeUpdateInstanceConfigurationTool: InternalToolConfig<
  OciComputeUpdateInstanceConfigurationParams,
  OciComputeResponse
> = {
  id: 'oci_compute_update_instance_configuration',
  name: 'OCI Compute Update Instance Configuration',
  description: 'Update configuration name and tags; launch settings require a new configuration',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_compute', credentialKind: 'service-account' },
  params: {
    oauthCredential: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Authorized OCI signing-key credential ID',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'OCI region, such as us-ashburn-1; must remain in the credential realm',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'System-injected credential identity; never used as a bearer token',
    },
    instanceConfigurationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Instance configuration OCID',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name; on list operations this is an exact provider filter',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form tags as a string-to-string JSON map',
    },
    definedTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Defined string tags grouped by namespace, for example {Operations: {CostCenter: "42"}}',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ETag from a previous get response; a conflict is returned instead of overwriting changed state',
    },
    retryToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Optional 1–64 character retry token. Reuse only for the same logical request within Oracle’s token lifetime; otherwise Sim derives an invocation key or generates one per call',
    },
  },
  operation: {
    input: (params) =>
      ociComputeOperationInput(params, [
        'instanceConfigurationId',
        'displayName',
        'freeformTags',
        'definedTags',
        'ifMatch',
        'retryToken',
      ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    retryToken: { type: 'string', description: 'Retry token used for this request' },
    instanceConfiguration: {
      type: 'json',
      description: 'Instance Configuration information returned by OCI',
      properties: INSTANCE_CONFIGURATION_OUTPUT_PROPERTIES,
    },
  },
}
