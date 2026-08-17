import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SplunkListIndexesParams, SplunkListIndexesResponse } from '@/tools/splunk/types'
import {
  asBoolean,
  asNumber,
  asString,
  buildSplunkHeaders,
  buildSplunkUrl,
  getEntryContent,
  getEntryName,
  getSplunkEntries,
  getSplunkPaging,
  SPLUNK_CONNECTION_PARAMS,
} from '@/tools/splunk/utils'
import type { ToolConfig } from '@/tools/types'

export const listIndexesTool: ToolConfig<SplunkListIndexesParams, SplunkListIndexesResponse> = {
  id: 'splunk_list_indexes',
  name: 'Splunk List Indexes',
  description:
    'List the indexes configured on the Splunk instance with their size, event count, and retention settings.',
  version: '1.0.0',

  params: {
    ...SPLUNK_CONNECTION_PARAMS,
    datatype: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter indexes by type: all, event, or metric. Splunk defaults to event, so pass all to include metric indexes.',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of indexes to return (e.g. 50). 0 returns all.',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first entry to return, for pagination',
    },
  },

  request: {
    url: (params) =>
      buildSplunkUrl(params, '/data/indexes', {
        datatype: params.datatype,
        count: params.count,
        offset: params.offset,
      }),
    method: 'GET',
    headers: (params) => buildSplunkHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const paging = getSplunkPaging(data)
    return {
      success: true,
      output: {
        indexes: getSplunkEntries(data).map((entry) => {
          const content = getEntryContent(entry)
          return {
            name: getEntryName(entry),
            id: asString(entry.id),
            updated: asString(entry.updated),
            datatype: asString(content.datatype),
            disabled: asBoolean(content.disabled),
            isInternal: asBoolean(content.isInternal),
            totalEventCount: asNumber(content.totalEventCount),
            currentDBSizeMB: asNumber(content.currentDBSizeMB),
            maxTotalDataSizeMB: asNumber(content.maxTotalDataSizeMB),
            frozenTimePeriodInSecs: asNumber(content.frozenTimePeriodInSecs),
            minTime: asString(content.minTime),
            maxTime: asString(content.maxTime),
            homePath: asString(content.homePath),
            coldPath: asString(content.coldPath),
            thawedPath: asString(content.thawedPath),
          }
        }),
        total: paging.total,
        offset: paging.offset,
      },
    }
  },

  errorExtractor: ErrorExtractorId.SPLUNK_ERRORS,

  /** `total`/`offset` inline by necessity — see the note on `runSearchTool.outputs`. */
  outputs: {
    indexes: {
      type: 'array',
      description: 'Indexes configured on the instance',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Index name' },
          id: { type: 'string', description: 'Fully qualified REST URI of the index' },
          updated: { type: 'string', description: 'Last update timestamp' },
          datatype: { type: 'string', description: 'Index data type (event or metric)' },
          disabled: { type: 'boolean', description: 'Whether the index is disabled' },
          isInternal: { type: 'boolean', description: 'Whether this is an internal Splunk index' },
          totalEventCount: { type: 'number', description: 'Total number of events in the index' },
          currentDBSizeMB: { type: 'number', description: 'Current index size in megabytes' },
          maxTotalDataSizeMB: {
            type: 'number',
            description: 'Maximum index size in megabytes before rolling to frozen',
          },
          frozenTimePeriodInSecs: {
            type: 'number',
            description: 'Age in seconds at which data rolls to frozen',
          },
          minTime: { type: 'string', description: 'Timestamp of the earliest event in the index' },
          maxTime: { type: 'string', description: 'Timestamp of the latest event in the index' },
          homePath: { type: 'string', description: 'Path to the hot and warm buckets' },
          coldPath: { type: 'string', description: 'Path to the cold buckets' },
          thawedPath: { type: 'string', description: 'Path to the thawed buckets' },
        },
      },
    },
    total: {
      type: 'number',
      description:
        'Total number of entries matching the request, from the response paging envelope. Compare with offset to decide whether another page remains.',
      optional: true,
    },
    offset: {
      type: 'number',
      description:
        'Offset of the first entry in this page, echoed from the response paging envelope',
      optional: true,
    },
  },
}
