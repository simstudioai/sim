import {
  extractGoogleApiError,
  type GoogleAnalyticsDataStream,
  type GoogleAnalyticsListDataStreamsParams,
  type GoogleAnalyticsListDataStreamsResponse,
  normalizePropertyName,
  toOptionalNumberParam,
} from '@/tools/google_analytics/types'
import type { ToolConfig } from '@/tools/types'

interface RawDataStream {
  name?: string
  displayName?: string
  type?: string
  createTime?: string
  updateTime?: string
  webStreamData?: { measurementId?: string; firebaseAppId?: string; defaultUri?: string }
  androidAppStreamData?: { firebaseAppId?: string; packageName?: string }
  iosAppStreamData?: { firebaseAppId?: string; bundleId?: string }
}

/**
 * Flattens the DataStream union field: exactly one of `webStreamData`,
 * `androidAppStreamData`, or `iosAppStreamData` is populated per stream type.
 */
function toDataStream(raw: RawDataStream): GoogleAnalyticsDataStream {
  return {
    name: raw.name ?? '',
    displayName: raw.displayName ?? null,
    type: raw.type ?? null,
    createTime: raw.createTime ?? null,
    updateTime: raw.updateTime ?? null,
    measurementId: raw.webStreamData?.measurementId ?? null,
    defaultUri: raw.webStreamData?.defaultUri ?? null,
    firebaseAppId:
      raw.webStreamData?.firebaseAppId ??
      raw.androidAppStreamData?.firebaseAppId ??
      raw.iosAppStreamData?.firebaseAppId ??
      null,
    packageName: raw.androidAppStreamData?.packageName ?? null,
    bundleId: raw.iosAppStreamData?.bundleId ?? null,
  }
}

export const googleAnalyticsListDataStreamsTool: ToolConfig<
  GoogleAnalyticsListDataStreamsParams,
  GoogleAnalyticsListDataStreamsResponse
> = {
  id: 'google_analytics_list_data_streams',
  name: 'List Google Analytics Data Streams',
  description:
    'List the web, Android, and iOS data streams configured on a Google Analytics 4 property',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-analytics',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for the Google Analytics Admin API',
    },
    propertyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'GA4 property ID (e.g. 123456789)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Data streams per page (default 50, max 200)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous response',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      const pageSize = toOptionalNumberParam(params.pageSize)
      if (pageSize !== undefined) query.set('pageSize', String(pageSize))
      if (params.pageToken) query.set('pageToken', params.pageToken)
      const suffix = query.toString()
      return `https://analyticsadmin.googleapis.com/v1beta/${normalizePropertyName(params.propertyId)}/dataStreams${suffix ? `?${suffix}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: { dataStreams: [], totalCount: 0, nextPageToken: null },
        error: extractGoogleApiError(data),
      }
    }

    const dataStreams = (data.dataStreams ?? []).map(toDataStream)

    return {
      success: true,
      output: {
        dataStreams,
        totalCount: dataStreams.length,
        nextPageToken: data.nextPageToken ?? null,
      },
    }
  },

  outputs: {
    dataStreams: {
      type: 'array',
      description: 'Data streams on the property',
      items: {
        type: 'json',
        description: 'Data stream',
        properties: {
          name: { type: 'string', description: 'Resource name (properties/{id}/dataStreams/{id})' },
          displayName: { type: 'string', description: 'Stream display name', nullable: true },
          type: {
            type: 'string',
            description: 'WEB_DATA_STREAM, ANDROID_APP_DATA_STREAM, or IOS_APP_DATA_STREAM',
            nullable: true,
          },
          createTime: { type: 'string', description: 'Creation timestamp', nullable: true },
          updateTime: { type: 'string', description: 'Last update timestamp', nullable: true },
          measurementId: {
            type: 'string',
            description: 'Web stream measurement ID (G-XXXXXXXXXX)',
            nullable: true,
          },
          defaultUri: { type: 'string', description: 'Web stream default URI', nullable: true },
          firebaseAppId: { type: 'string', description: 'Linked Firebase app ID', nullable: true },
          packageName: { type: 'string', description: 'Android package name', nullable: true },
          bundleId: { type: 'string', description: 'iOS bundle ID', nullable: true },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Number of data streams returned on this page',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for the next page of data streams',
      nullable: true,
    },
  },
}
