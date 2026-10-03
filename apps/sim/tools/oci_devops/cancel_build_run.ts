import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsCancelBuildRunParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsCancelBuildRunTool: InternalToolConfig<
  OciDevopsCancelBuildRunParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_cancel_build_run',
  name: 'OCI DevOps Cancel Build Run',
  description: 'Cancel Build Run in OCI DevOps',
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
    buildRunId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique build run identifier.',
    },
    reason: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The reason for canceling the build run.',
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
      buildRunId: params.buildRunId,
      reason: params.reason,
      retryToken: params.retryToken,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
