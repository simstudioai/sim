import type {
  GoogleWorkspaceAdminBatchChangeChromeOsDeviceStatusParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  DEFAULT_CUSTOMER,
  DIRECTORY_API_BASE,
  parseDeviceIds,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * A per-device outcome. The Admin SDK returns HTTP 200 for the batch as a whole
 * and reports each device individually, so a device that stayed enabled is only
 * visible through its `error`.
 */
interface ChangeChromeOsDeviceStatusResult {
  deviceId?: string
  response?: unknown
  error?: { code?: number; message?: string; details?: unknown[] }
}

interface BatchChangeChromeOsDeviceStatusApiResponse {
  changeChromeOsDeviceStatusResults?: ChangeChromeOsDeviceStatusResult[]
}

/**
 * The only action the Admin SDK pairs with a deprovision reason. The reason is
 * required for it and rejected for the other two actions, so the body builder
 * gates on this value rather than on whether a reason happens to be set.
 */
const DEPROVISION_ACTION = 'CHANGE_CHROME_OS_DEVICE_STATUS_ACTION_DEPROVISION'

export const batchChangeChromeOsDeviceStatusTool: ToolConfig<
  GoogleWorkspaceAdminBatchChangeChromeOsDeviceStatusParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_batch_change_chromeos_device_status',
  name: 'Google Workspace Admin Batch Change ChromeOS Device Status',
  description:
    'Deprovision, disable, or re-enable up to 50 ChromeOS devices at once. Deprovisioning removes the device from management and cannot be undone',
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
    deviceIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated IDs of the ChromeOS devices to change, as returned by List ChromeOS Devices. Maximum 50',
    },
    changeChromeOsDeviceStatusAction: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Status change to apply: CHANGE_CHROME_OS_DEVICE_STATUS_ACTION_DEPROVISION (remove from management, irreversible), CHANGE_CHROME_OS_DEVICE_STATUS_ACTION_DISABLE (keep managed but unusable), or CHANGE_CHROME_OS_DEVICE_STATUS_ACTION_REENABLE',
    },
    deprovisionReason: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Why the devices are being deprovisioned. Required when the action is CHANGE_CHROME_OS_DEVICE_STATUS_ACTION_DEPROVISION, and omitted otherwise',
    },
  },

  request: {
    url: (params) => {
      const customer = params.customerId || DEFAULT_CUSTOMER
      return `${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/devices/chromeos:batchChangeStatus`
    },
    method: 'POST',
    headers: adminHeaders,
    body: (params) => {
      const action = params.changeChromeOsDeviceStatusAction
      const body: Record<string, unknown> = {
        deviceIds: parseDeviceIds(params.deviceIds),
        changeChromeOsDeviceStatusAction: action,
      }
      if (action === DEPROVISION_ACTION) {
        if (!params.deprovisionReason) {
          throw new Error('deprovisionReason is required when the action is DEPROVISION')
        }
        body.deprovisionReason = params.deprovisionReason
      }
      return JSON.stringify(body)
    },
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<BatchChangeChromeOsDeviceStatusApiResponse>(
      response,
      'Failed to change ChromeOS device status'
    )
    const results = data.changeChromeOsDeviceStatusResults ?? []
    const failed = results.filter((result) => result.error !== undefined)
    const succeededDeviceIds = results
      .filter((result) => result.error === undefined)
      .map((result) => result.deviceId ?? '')
      .filter((deviceId) => deviceId.length > 0)

    if (failed.length > 0) {
      return {
        success: false,
        error: `${failed.length} of ${results.length} ChromeOS devices failed to change status: ${failed
          .map(
            (result) =>
              `${result.deviceId ?? 'unknown device'} (${result.error?.message ?? 'no reason given'})`
          )
          .join('; ')}`,
        output: {
          changeChromeOsDeviceStatusResults: results,
          succeededDeviceIds,
          failedDeviceIds: failed.map((result) => result.deviceId ?? '').filter(Boolean),
        },
      }
    }

    return {
      success: true,
      output: {
        changeChromeOsDeviceStatusResults: results,
        succeededDeviceIds,
        failedDeviceIds: [],
      },
    }
  },

  outputs: {
    changeChromeOsDeviceStatusResults: {
      type: 'json',
      description:
        'One result per requested device. Each carries either a response (the change succeeded) or an error',
      items: {
        type: 'json',
        properties: {
          deviceId: { type: 'string', description: 'Unique ID of the ChromeOS device' },
          response: {
            type: 'json',
            description: 'Present when the device changed status successfully',
            optional: true,
          },
          error: {
            type: 'json',
            description:
              'Present when the device failed to change status, with code, message, and details',
            optional: true,
          },
        },
      },
    },
    succeededDeviceIds: {
      type: 'array',
      description:
        'IDs of the devices that did change status, so a partial failure can be retried for the rest',
      items: { type: 'string' },
    },
    failedDeviceIds: {
      type: 'array',
      description: 'IDs of the devices that did not change status',
      items: { type: 'string' },
    },
  },
}
