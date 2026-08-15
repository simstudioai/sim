import type {
  GoogleWorkspaceAdminResponse,
  GoogleWorkspaceAdminUpdateChromeOsDeviceParams,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  DEFAULT_CUSTOMER,
  DIRECTORY_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

export const updateChromeOsDeviceTool: ToolConfig<
  GoogleWorkspaceAdminUpdateChromeOsDeviceParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_update_chromeos_device',
  name: 'Google Workspace Admin Update ChromeOS Device',
  description:
    'Update the administrator-assigned fields on a ChromeOS device, including its assigned user, location, asset ID, notes, and org unit',
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
    annotatedUser: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User the device is assigned to',
    },
    annotatedLocation: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Physical location of the device',
    },
    annotatedAssetId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Asset identifier assigned to the device',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form administrator notes about the device',
    },
    orgUnitPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full path of the org unit to move the device into (e.g. /Sales/West)',
    },
  },

  request: {
    url: (params) => {
      const customer = params.customerId || DEFAULT_CUSTOMER
      return `${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/devices/chromeos/${encodeURIComponent(params.deviceId)}`
    },
    method: 'PATCH',
    headers: adminHeaders,
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.annotatedUser !== undefined) body.annotatedUser = params.annotatedUser
      if (params.annotatedLocation !== undefined) body.annotatedLocation = params.annotatedLocation
      if (params.annotatedAssetId !== undefined) body.annotatedAssetId = params.annotatedAssetId
      if (params.notes !== undefined) body.notes = params.notes
      if (params.orgUnitPath) body.orgUnitPath = params.orgUnitPath
      return JSON.stringify(body)
    },
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<unknown>(response, 'Failed to update ChromeOS device')
    return {
      success: true,
      output: { chromeOsDevice: data },
    }
  },

  outputs: {
    chromeOsDevice: {
      type: 'json',
      description: 'The updated ChromeOsDevice resource',
      properties: {
        deviceId: { type: 'string', description: 'Unique ID of the ChromeOS device' },
        serialNumber: { type: 'string', description: 'Serial number of the device' },
        status: { type: 'string', description: 'Provisioning status of the device' },
        orgUnitPath: { type: 'string', description: 'Org unit the device belongs to' },
        annotatedUser: { type: 'string', description: 'Administrator-assigned user' },
        annotatedLocation: { type: 'string', description: 'Administrator-assigned location' },
        annotatedAssetId: { type: 'string', description: 'Administrator-assigned asset ID' },
        notes: { type: 'string', description: 'Administrator notes about the device' },
      },
    },
  },
}
