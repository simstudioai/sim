import {
  CAPACITY_REPORT_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
  type OciComputeCreateComputeCapacityReportParams,
  type OciComputeResponse,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeCreateComputeCapacityReportTool: InternalToolConfig<
  OciComputeCreateComputeCapacityReportParams,
  OciComputeResponse
> = {
  id: 'oci_compute_create_compute_capacity_report',
  name: 'OCI Compute Create compute capacity report',
  description:
    'Inspect available capacity for requested shapes without reserving or launching resources',
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
    availabilityDomain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Exact availability-domain name returned by OCI discovery',
    },
    retryToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Optional 1–64 character retry token. Reuse only for the same logical creation request; otherwise Sim derives an invocation key',
    },
    shapeAvailabilities: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Capacity queries [{instanceShape, instanceShapeConfig: {ocpus, memoryInGBs}, faultDomain}]; reports do not reserve capacity',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, [
      'compartmentId',
      'availabilityDomain',
      'retryToken',
      'shapeAvailabilities',
    ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    retryToken: { type: 'string', description: 'Retry token used for this creation request' },
    capacityReport: {
      type: 'json',
      description: 'Capacity Report information returned by OCI',
      properties: CAPACITY_REPORT_OUTPUT_PROPERTIES,
    },
  },
}

