import {
  INSTANCE_OUTPUT_PROPERTIES,
  type OciComputeInstanceActionParams,
  type OciComputeResponse,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeInstanceActionTool: InternalToolConfig<
  OciComputeInstanceActionParams,
  OciComputeResponse
> = {
  id: 'oci_compute_instance_action',
  name: 'OCI Compute Instance Action',
  description:
    'Start, stop, reset, or reboot-migrate an instance; actions may interrupt workloads or incur charges',
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
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ETag from a previous get response; a conflict is returned instead of overwriting changed state',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Instance action: START, STOP, SOFTSTOP, RESET, SOFTRESET, or REBOOTMIGRATE. Pools support the first five',
    },
    allowDenseRebootMigration: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'For RESET/SOFTRESET only: enabling DenseIO reboot migration permanently deletes local SSD data',
    },
    deleteLocalStorage: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'For REBOOTMIGRATE only: explicitly permit deletion of local storage on applicable bare metal instances',
    },
    timeScheduled: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'RFC3339 REBOOTMIGRATE timestamp; omit for immediate migration',
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
        'ifMatch',
        'action',
        'allowDenseRebootMigration',
        'deleteLocalStorage',
        'timeScheduled',
        'retryToken',
      ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    retryToken: { type: 'string', description: 'Retry token used for this request' },
    instance: {
      type: 'json',
      description: 'Instance information returned by OCI',
      properties: INSTANCE_OUTPUT_PROPERTIES,
    },
  },
}
