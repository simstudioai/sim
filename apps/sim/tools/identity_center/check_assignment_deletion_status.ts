import type {
  IdentityCenterAssignmentStatusResponse,
  IdentityCenterCheckAssignmentStatusParams,
} from '@/tools/identity_center/types'
import type { ToolConfig } from '@/tools/types'

export const checkAssignmentDeletionStatusTool: ToolConfig<
  IdentityCenterCheckAssignmentStatusParams,
  IdentityCenterAssignmentStatusResponse
> = {
  id: 'identity_center_check_assignment_deletion_status',
  name: 'Identity Center Check Assignment Deletion Status',
  description: 'Check the deprovisioning status of an account assignment deletion request',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    instanceArn: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ARN of the Identity Center instance',
    },
    requestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Request ID returned from Delete Account Assignment',
    },
  },

  request: {
    url: '/api/tools/identity-center/check-assignment-deletion-status',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      instanceArn: params.instanceArn,
      requestId: params.requestId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to check assignment deletion status')
    }
    return {
      success: true,
      output: {
        message: data.message ?? '',
        status: data.status ?? '',
        requestId: data.requestId ?? '',
        accountId: data.accountId ?? null,
        permissionSetArn: data.permissionSetArn ?? null,
        principalType: data.principalType ?? null,
        principalId: data.principalId ?? null,
        failureReason: data.failureReason ?? null,
        createdDate: data.createdDate ?? null,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Human-readable status message' },
    status: {
      type: 'string',
      description: 'Current deletion status: IN_PROGRESS, FAILED, or SUCCEEDED',
    },
    requestId: { type: 'string', description: 'The deletion request ID that was checked' },
    accountId: { type: 'string', description: 'Target AWS account ID', optional: true },
    permissionSetArn: { type: 'string', description: 'Permission set ARN', optional: true },
    principalType: {
      type: 'string',
      description: 'Principal type (USER or GROUP)',
      optional: true,
    },
    principalId: { type: 'string', description: 'Principal ID', optional: true },
    failureReason: {
      type: 'string',
      description: 'Reason for failure if status is FAILED',
      optional: true,
    },
    createdDate: { type: 'string', description: 'Date the request was created', optional: true },
  },
}
