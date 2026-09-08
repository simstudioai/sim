import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsApproveDeploymentParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsApproveDeploymentTool: InternalToolConfig<
  OciDevopsApproveDeploymentParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_approve_deployment',
  name: 'OCI DevOps Approve Deployment',
  description: 'Approve Deployment in OCI DevOps',
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
    deploymentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique deployment identifier.',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The action of Approve or Reject. Allowed: APPROVE, REJECT.',
    },
    deployStageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The [OCID](/Content/General/Concepts/identifiers.htm) of the stage which is marked for approval.',
    },
    reason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The reason for approving or rejecting the deployment.',
    },
    retryToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Stable idempotency token (1–64 ASCII characters). Reuse for retries of this action; use a new token for a new action.',
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
      deploymentId: params.deploymentId,
      action: params.action,
      deployStageId: params.deployStageId,
      reason: params.reason,
      retryToken: params.retryToken,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
