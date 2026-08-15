import type {
  GoogleWorkspaceAdminMobileDeviceActionParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  assertAdminSuccess,
  DEFAULT_CUSTOMER,
  DIRECTORY_API_BASE,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const actionMobileDeviceTool: ToolConfig<
  GoogleWorkspaceAdminMobileDeviceActionParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_action_mobile_device',
  name: 'Google Workspace Admin Action Mobile Device',
  description:
    'Run an administrative action on an enrolled mobile device, such as approving, blocking, or remotely wiping it. Wipe actions erase data on the device and cannot be undone',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-workspace-admin',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    customerId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Customer ID, or "my_customer" for the authenticated account (default)',
    },
    resourceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique resource ID of the device, as returned by List Mobile Devices',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Action to run: admin_remote_wipe (erase the whole device), admin_account_wipe (erase only the Workspace account data), approve, block, cancel_remote_wipe_then_activate, or cancel_remote_wipe_then_block',
    },
  },

  request: {
    url: (params) => {
      const customer = params.customerId || DEFAULT_CUSTOMER
      return `${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/devices/mobile/${encodeURIComponent(params.resourceId)}/action`
    },
    method: 'POST',
    headers: adminHeaders,
    body: (params) => JSON.stringify({ action: params.action }),
  },

  transformResponse: async (response) => {
    await assertAdminSuccess(response, 'Failed to run mobile device action')
    return {
      success: true,
      output: { message: 'Mobile device action accepted' },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Confirmation that the action was accepted' },
  },
}
