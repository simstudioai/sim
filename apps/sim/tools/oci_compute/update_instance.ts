import {
  INSTANCE_OUTPUT_PROPERTIES,
  type OciComputeResponse,
  type OciComputeUpdateInstanceParams,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeUpdateInstanceTool: InternalToolConfig<
  OciComputeUpdateInstanceParams,
  OciComputeResponse
> = {
  id: 'oci_compute_update_instance',
  name: 'OCI Compute Update Instance',
  description: 'Update instance settings with optimistic concurrency and explicit downtime control',
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
    instanceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Compute instance OCID',
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
    shape: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Compute shape name; image, capacity, and shape compatibility are validated by OCI',
    },
    shapeConfig: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Shape resources: ocpus OR vcpus, memoryInGBs, baselineOcpuUtilization, nvmes; use List Shapes for valid ranges',
    },
    faultDomain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fault domain within the selected availability domain',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'String-to-string metadata map; user_data is base64 and ssh_authorized_keys contains SSH public keys. Updates replace the map and must retain immutable launch keys unchanged',
    },
    extendedMetadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Nested metadata map; combined with metadata, at most 32000 bytes. Updates must preserve immutable launch keys',
    },
    agentConfig: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Oracle Cloud Agent settings: isMonitoringDisabled, isManagementDisabled, areAllPluginsDisabled, pluginsConfig [{name, desiredState: ENABLED or DISABLED}]',
    },
    availabilityConfig: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Availability settings: recoveryAction (RESTORE_INSTANCE or STOP_INSTANCE), isLiveMigrationPreferred',
    },
    instanceOptions: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Instance options: areLegacyImdsEndpointsDisabled',
    },
    capacityReservationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Existing reservation OCID; an empty string opts out on direct launch or removes the reservation on update',
    },
    dedicatedVmHostId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Existing dedicated VM host OCID; placement restrictions and capacity are enforced by OCI',
    },
    timeMaintenanceRebootDue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'RFC3339 VM maintenance reboot schedule within the maximum returned by Get Instance Maintenance Reboot',
    },
    updateOperationConstraint: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'AVOID_DOWNTIME (default) rejects updates requiring a reboot; ALLOW_DOWNTIME permits downtime',
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
        'instanceId',
        'displayName',
        'freeformTags',
        'definedTags',
        'ifMatch',
        'shape',
        'shapeConfig',
        'faultDomain',
        'metadata',
        'extendedMetadata',
        'agentConfig',
        'availabilityConfig',
        'instanceOptions',
        'capacityReservationId',
        'dedicatedVmHostId',
        'timeMaintenanceRebootDue',
        'updateOperationConstraint',
        'retryToken',
      ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    workRequestId: {
      type: 'string',
      description: 'Work request OCID when returned; use status tools',
      nullable: true,
    },
    retryToken: { type: 'string', description: 'Retry token used for this request' },
    instance: {
      type: 'json',
      description: 'Instance information returned by OCI',
      properties: INSTANCE_OUTPUT_PROPERTIES,
    },
  },
}
