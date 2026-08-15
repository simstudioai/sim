import type {
  GoogleWorkspaceAdminGetChromeOsDeviceParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  appendQueryParams,
  DEFAULT_CUSTOMER,
  DEVICE_PROJECTION,
  DIRECTORY_API_BASE,
  normalizeEnumValue,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const getChromeOsDeviceTool: ToolConfig<
  GoogleWorkspaceAdminGetChromeOsDeviceParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_get_chromeos_device',
  name: 'Google Workspace Admin Get ChromeOS Device',
  description: 'Read a single ChromeOS device enrolled in a Google Workspace account',
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
    deviceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the ChromeOS device, as returned by List ChromeOS Devices',
    },
    projection: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Fields to include: BASIC or FULL',
    },
  },

  request: {
    url: (params) => {
      const customer = params.customerId || DEFAULT_CUSTOMER
      const url = new URL(
        `${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/devices/chromeos/${encodeURIComponent(params.deviceId)}`
      )
      appendQueryParams(url, {
        projection: normalizeEnumValue('projection', params.projection, DEVICE_PROJECTION),
      })
      return url.toString()
    },
    method: 'GET',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<unknown>(response, 'Failed to get ChromeOS device')
    return {
      success: true,
      output: { chromeOsDevice: data },
    }
  },

  outputs: {
    chromeOsDevice: {
      type: 'json',
      description: 'The ChromeOsDevice resource',
      properties: {
        deviceId: { type: 'string', description: 'Unique ID of the ChromeOS device' },
        serialNumber: { type: 'string', description: 'Serial number of the device' },
        status: { type: 'string', description: 'Provisioning status of the device' },
        orgUnitPath: { type: 'string', description: 'Org unit the device belongs to' },
        annotatedUser: { type: 'string', description: 'Administrator-assigned user' },
        annotatedLocation: { type: 'string', description: 'Administrator-assigned location' },
        annotatedAssetId: { type: 'string', description: 'Administrator-assigned asset ID' },
        lastSync: { type: 'string', description: 'Timestamp of the last device sync' },
      },
    },
  },
}
