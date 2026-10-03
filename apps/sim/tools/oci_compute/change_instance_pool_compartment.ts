import {
  type OciComputeChangeInstancePoolCompartmentParams,
  type OciComputeResponse,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeChangeInstancePoolCompartmentTool: InternalToolConfig<
  OciComputeChangeInstancePoolCompartmentParams,
  OciComputeResponse
> = {
  id: 'oci_compute_change_instance_pool_compartment',
  name: 'OCI Compute Change Instance Pool Compartment',
  description: 'Change instance pool compartment in OCI',
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
    instancePoolId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Instance pool OCID',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ETag from a previous get response; a conflict is returned instead of overwriting changed state',
    },
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Compartment OCID; use the destination for moves, parent for compartment listing, and root for capacity reports',
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
        'instancePoolId',
        'ifMatch',
        'compartmentId',
        'retryToken',
      ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    retryToken: { type: 'string', description: 'Retry token used for this request' },
  },
}
