import type {
  GoogleWorkspaceAdminGetMobileDeviceParams,
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

export const getMobileDeviceTool: ToolConfig<
  GoogleWorkspaceAdminGetMobileDeviceParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_get_mobile_device',
  name: 'Google Workspace Admin Get Mobile Device',
  description: 'Read a single mobile device enrolled in a Google Workspace account',
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
        `${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/devices/mobile/${encodeURIComponent(params.resourceId)}`
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
    const data = await readAdminJson<unknown>(response, 'Failed to get mobile device')
    return {
      success: true,
      output: { mobileDevice: data },
    }
  },

  outputs: {
    mobileDevice: {
      type: 'json',
      description: 'The MobileDevice resource',
      properties: {
        resourceId: { type: 'string', description: 'Unique resource ID used by device actions' },
        deviceId: { type: 'string', description: 'Serial number reported by the device' },
        email: { type: 'json', description: 'Email addresses associated with the device' },
        model: { type: 'string', description: 'Device model' },
        os: { type: 'string', description: 'Operating system reported by the device' },
        status: { type: 'string', description: 'Enrollment status of the device' },
        type: { type: 'string', description: 'Device management type' },
        lastSync: { type: 'string', description: 'Timestamp of the last device sync' },
      },
    },
  },
}
