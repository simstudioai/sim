import type { AlgoliaGetSettingsParams, AlgoliaGetSettingsResponse } from '@/tools/algolia/types'
import type { ToolConfig } from '@/tools/types'

export const getSettingsTool: ToolConfig<AlgoliaGetSettingsParams, AlgoliaGetSettingsResponse> = {
  id: 'algolia_get_settings',
  name: 'Algolia Get Settings',
  description: 'Retrieve the settings of an Algolia index',
  version: '1.0',

  params: {
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Algolia Application ID',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Algolia API Key',
    },
    indexName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the Algolia index',
    },
  },

  request: {
    method: 'GET',
    url: (params) =>
      `https://${params.applicationId}-dsn.algolia.net/1/indexes/${encodeURIComponent(params.indexName)}/settings`,
    headers: (params) => ({
      'x-algolia-application-id': params.applicationId,
      'x-algolia-api-key': params.apiKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        searchableAttributes: data.searchableAttributes ?? null,
        attributesForFaceting: data.attributesForFaceting ?? [],
        ranking: data.ranking ?? [],
        customRanking: data.customRanking ?? [],
        replicas: data.replicas ?? [],
        hitsPerPage: data.hitsPerPage ?? 20,
        maxValuesPerFacet: data.maxValuesPerFacet ?? 100,
        highlightPreTag: data.highlightPreTag ?? '<em>',
        highlightPostTag: data.highlightPostTag ?? '</em>',
        paginationLimitedTo: data.paginationLimitedTo ?? 1000,
      },
    }
  },

  outputs: {
    searchableAttributes: {
      type: 'array',
      description: 'List of searchable attributes',
      optional: true,
      items: { type: 'string', description: 'Searchable attribute name or expression' },
    },
    attributesForFaceting: {
      type: 'array',
      description: 'Attributes used for faceting',
      items: { type: 'string', description: 'Faceting attribute name or expression' },
    },
    ranking: {
      type: 'array',
      description: 'Ranking criteria',
      items: { type: 'string', description: 'Ranking criterion' },
    },
    customRanking: {
      type: 'array',
      description: 'Custom ranking criteria',
      items: { type: 'string', description: 'Custom ranking expression (e.g., desc(popularity))' },
    },
    replicas: {
      type: 'array',
      description: 'List of replica index names',
      items: { type: 'string', description: 'Replica index name' },
    },
    hitsPerPage: {
      type: 'number',
      description: 'Default number of hits per page',
    },
    maxValuesPerFacet: {
      type: 'number',
      description: 'Maximum number of facet values returned',
    },
    highlightPreTag: {
      type: 'string',
      description: 'HTML tag inserted before highlighted parts',
    },
    highlightPostTag: {
      type: 'string',
      description: 'HTML tag inserted after highlighted parts',
    },
    paginationLimitedTo: {
      type: 'number',
      description: 'Maximum number of hits accessible via pagination',
    },
  },
}
