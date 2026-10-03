import {
  type OciComputeDetachInstancePoolInstanceParams,
  type OciComputeResponse,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeDetachInstancePoolInstanceTool: InternalToolConfig<
  OciComputeDetachInstancePoolInstanceParams,
  OciComputeResponse
> = {
  id: 'oci_compute_detach_instance_pool_instance',
  name: 'OCI Compute Detach Instance Pool Instance',
  description: 'Detach a pool member with explicit termination and replacement-size choices',
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
    instanceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Compute instance OCID',
    },
    isAutoTerminate: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Terminate the detached instance (default false)',
    },
    isDecrementSize: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Reduce desired pool size when detaching (default true); false can create a billable replacement',
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
        'instanceId',
        'isAutoTerminate',
        'isDecrementSize',
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
  },
}
