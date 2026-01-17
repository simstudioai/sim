import type { DatasetParams, DatasetResponse } from '@/tools/brightdata/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Bright Data Npm Package dataset tool.
 */
export const datasetNpmPackageTool: ToolConfig<DatasetParams, DatasetResponse> = {
  id: 'brightdata_dataset_npm_package',
  name: 'Bright Data Npm Package Dataset',
  description:
    'Quickly read structured npm package data.\nRequires a valid npm package name (e.g., @brightdata/sdk).\nThis can be a cache lookup, so it can be more reliable than scraping',
  version: '1.0.0',

  params: {
    package_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Package name',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Bright Data API token',
    },
  },

  request: {
    method: 'POST',
    url: '/api/tools/brightdata/dataset',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        datasetId: 'gd_mk57m0301khq4jmsul',
        apiToken: params.apiToken,
        package_name: params.package_name,
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Bright Data dataset fetch failed')
    }

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    data: {
      type: 'object',
      description: 'Structured dataset response',
    },
    snapshot_at: {
      type: 'string',
      description: 'Timestamp of data snapshot',
      optional: true,
    },
  },
}
