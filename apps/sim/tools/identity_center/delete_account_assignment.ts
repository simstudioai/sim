import type {
  IdentityCenterAssignmentStatusResponse,
  IdentityCenterDeleteAccountAssignmentParams,
} from '@/tools/identity_center/types'
import type { ToolConfig } from '@/tools/types'

export const deleteAccountAssignmentTool: ToolConfig<
  IdentityCenterDeleteAccountAssignmentParams,
  IdentityCenterAssignmentStatusResponse
> = {
  id: 'identity_center_delete_account_assignment',
  name: 'Identity Center Delete Account Assignment',
  description:
    'Revoke a user or group access to an AWS account by removing a permission set assignment',
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
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'AWS account ID to revoke access from',
    },
    permissionSetArn: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ARN of the permission set to remove',
    },
    principalType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type of principal: USER or GROUP',
    },
    principalId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identity Store ID of the user or group',
    },
  },

  request: {
    url: '/api/tools/identity-center/delete-account-assignment',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      instanceArn: params.instanceArn,
      accountId: params.accountId,
      permissionSetArn: params.permissionSetArn,
      principalType: params.principalType,
      principalId: params.principalId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete account assignment')
    }
    return {
      success: true,
      output: {
        message: data.message ?? 'Account assignment deletion initiated',
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
    message: { type: 'string', description: 'Status message' },
    status: {
      type: 'string',
      description: 'Deprovisioning status: IN_PROGRESS, FAILED, or SUCCEEDED',
    },
    requestId: {
      type: 'string',
      description: 'Request ID to use with Check Assignment Status',
    },
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
