import type {
  GoogleWorkspaceAdminListMobileDevicesParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  appendQueryParams,
  DEFAULT_CUSTOMER,
  DIRECTORY_API_BASE,
  readAdminJson,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

interface ListMobileDevicesApiResponse {
  mobiledevices?: unknown[]
  nextPageToken?: string
}

export const listMobileDevicesTool: ToolConfig<
  GoogleWorkspaceAdminListMobileDevicesParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_list_mobile_devices',
  name: 'Google Workspace Admin List Mobile Devices',
  description: 'List the mobile devices enrolled in a Google Workspace account',
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
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Device search query (e.g. "email:jane@example.com" or "model:Pixel")',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of devices to return (max 100). Example: 50',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for fetching the next page of results',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Field to sort by: DEVICE_ID, EMAIL, LAST_SYNC, MODEL, NAME, OS, STATUS, or TYPE',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort direction: ASCENDING or DESCENDING',
    },
    projection: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Fields to include for each device: BASIC or FULL',
    },
  },

  request: {
    url: (params) => {
      const customer = params.customerId || DEFAULT_CUSTOMER
      const url = new URL(
        `${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/devices/mobile`
      )
      appendQueryParams(url, {
        query: params.query,
        maxResults: params.maxResults,
        pageToken: params.pageToken,
        orderBy: params.orderBy,
        sortOrder: params.sortOrder,
        projection: params.projection,
      })
      return url.toString()
    },
    method: 'GET',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<ListMobileDevicesApiResponse>(
      response,
      'Failed to list mobile devices'
    )
    return {
      success: true,
      output: {
        mobileDevices: data.mobiledevices ?? [],
        nextPageToken: data.nextPageToken ?? undefined,
      },
    }
  },

  outputs: {
    mobileDevices: {
      type: 'json',
      description: 'Array of MobileDevice resources',
      items: {
        type: 'json',
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
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching the next page of results',
      optional: true,
    },
  },
}
