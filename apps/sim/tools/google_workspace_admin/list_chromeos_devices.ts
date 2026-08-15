import type {
  GoogleWorkspaceAdminListChromeOsDevicesParams,
  GoogleWorkspaceAdminResponse,
} from '@/tools/google_workspace_admin/types'
import {
  adminHeaders,
  appendQueryParams,
  CHROMEOS_ORDER_BY,
  DEFAULT_CUSTOMER,
  DEVICE_PROJECTION,
  DIRECTORY_API_BASE,
  normalizeEnumValue,
  readAdminJson,
  SORT_ORDER,
} from '@/tools/google_workspace_admin/utils'
import type { ToolConfig } from '@/tools/types'

interface ListChromeOsDevicesApiResponse {
  chromeosdevices?: unknown[]
  nextPageToken?: string
}

export const listChromeOsDevicesTool: ToolConfig<
  GoogleWorkspaceAdminListChromeOsDevicesParams,
  GoogleWorkspaceAdminResponse
> = {
  id: 'google_workspace_admin_list_chromeos_devices',
  name: 'Google Workspace Admin List ChromeOS Devices',
  description: 'List the ChromeOS devices enrolled in a Google Workspace account',
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
    orgUnitPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only devices in this org unit path (e.g. /Sales)',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Device search query (e.g. "user:jane@example.com" or "status:provisioned")',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of devices to return (should not exceed 300). Example: 100',
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
        'Field to sort by: annotatedLocation, annotatedUser, lastSync, notes, serialNumber, or status',
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
    includeChildOrgunits: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Also return devices in org units nested under the requested org unit path',
    },
  },

  request: {
    url: (params) => {
      const customer = params.customerId || DEFAULT_CUSTOMER
      const url = new URL(
        `${DIRECTORY_API_BASE}/customer/${encodeURIComponent(customer)}/devices/chromeos`
      )
      appendQueryParams(url, {
        orgUnitPath: params.orgUnitPath,
        query: params.query,
        maxResults: params.maxResults,
        pageToken: params.pageToken,
        orderBy: normalizeEnumValue('orderBy', params.orderBy, CHROMEOS_ORDER_BY),
        sortOrder: normalizeEnumValue('sortOrder', params.sortOrder, SORT_ORDER),
        projection: normalizeEnumValue('projection', params.projection, DEVICE_PROJECTION),
      })
      if (params.includeChildOrgunits !== undefined) {
        url.searchParams.set('includeChildOrgunits', String(params.includeChildOrgunits))
      }
      return url.toString()
    },
    method: 'GET',
    headers: adminHeaders,
  },

  transformResponse: async (response) => {
    const data = await readAdminJson<ListChromeOsDevicesApiResponse>(
      response,
      'Failed to list ChromeOS devices'
    )
    return {
      success: true,
      output: {
        chromeOsDevices: data.chromeosdevices ?? [],
        nextPageToken: data.nextPageToken ?? undefined,
      },
    }
  },

  outputs: {
    chromeOsDevices: {
      type: 'json',
      description: 'Array of ChromeOsDevice resources',
      items: {
        type: 'json',
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
    nextPageToken: {
      type: 'string',
      description: 'Token for fetching the next page of results',
      optional: true,
    },
  },
}
