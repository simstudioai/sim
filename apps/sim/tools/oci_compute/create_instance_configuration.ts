import {
  INSTANCE_CONFIGURATION_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
  type OciComputeCreateInstanceConfigurationParams,
  type OciComputeResponse,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeCreateInstanceConfigurationTool: InternalToolConfig<
  OciComputeCreateInstanceConfigurationParams,
  OciComputeResponse
> = {
  id: 'oci_compute_create_instance_configuration',
  name: 'OCI Compute Create instance configuration',
  description:
    'Create a reusable typed instance configuration or copy an existing instance’s settings, excluding disk contents',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_compute', credentialKind: 'service-account' },
  params: {
    oauthCredential: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Authorized OCI signing-key credential ID',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'OCI region, such as us-ashburn-1; must remain in the credential realm',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'System-injected credential identity; never used as a bearer token',
    },
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Compartment OCID; use the destination for moves, parent for compartment listing, and root for capacity reports',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Display name; on list operations this is an exact provider filter',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Free-form tags as a string-to-string JSON map',
    },
    definedTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Defined string tags grouped by namespace, for example {Operations: {CostCenter: "42"}}',
    },
    retryToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Optional 1–64 character retry token. Reuse only for the same logical creation request; otherwise Sim derives an invocation key',
    },
    configurationSource: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'NONE creates a typed template using instanceDetails; INSTANCE copies settings using instanceId, not disk contents',
    },
    instanceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Compute instance OCID',
    },
    instanceDetails: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Typed compute configuration: {instanceType: "compute", launchDetails: {...}, blockVolumes: [{volumeId, attachDetails: {type: "iscsi" or "paravirtualized", ...}}], secondaryVnics: [{createVnicDetails, displayName, nicIndex}]}. Deferred launch fields may be omitted. Volume creation and arbitrary provider fields are not accepted',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, [
      'compartmentId',
      'displayName',
      'freeformTags',
      'definedTags',
      'retryToken',
      'configurationSource',
      'instanceId',
      'instanceDetails',
    ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    retryToken: { type: 'string', description: 'Retry token used for this creation request' },
    instanceConfiguration: {
      type: 'json',
      description: 'Instance Configuration information returned by OCI',
      properties: INSTANCE_CONFIGURATION_OUTPUT_PROPERTIES,
    },
  },
}

