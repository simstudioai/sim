import type { GongListTrackersParams, GongListTrackersResponse } from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const listTrackersTool: ToolConfig<GongListTrackersParams, GongListTrackersResponse> = {
  id: 'gong_list_trackers',
  name: 'Gong List Trackers',
  description: 'Retrieve smart tracker and keyword tracker definitions from Gong settings.',
  version: '1.0.0',

  params: {
    accessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key',
    },
    accessKeySecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key Secret',
    },
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the workspace the keyword trackers are in. When empty, all trackers in all workspaces are returned.',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.gong.io/v2/settings/trackers')
      if (params.workspaceId) url.searchParams.set('workspaceId', params.workspaceId)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.message || data.message || 'Failed to list trackers')
    }
    const trackers = (data.keywordTrackers ?? []).map((t: Record<string, unknown>) => ({
      trackerId: t.trackerId ?? '',
      trackerName: t.trackerName ?? '',
      workspaceId: t.workspaceId ?? null,
      languageKeywords: ((t.languageKeywords as Record<string, unknown>[] | undefined) ?? []).map(
        (lk: Record<string, unknown>) => ({
          language: lk.language ?? null,
          keywords: lk.keywords ?? [],
          includeRelatedForms: lk.includeRelatedForms ?? false,
        })
      ),
      affiliation: t.affiliation ?? null,
      partOfQuestion: t.partOfQuestion ?? null,
      saidAt: t.saidAt ?? null,
      saidAtInterval: t.saidAtInterval ?? null,
      saidAtUnit: t.saidAtUnit ?? null,
      saidInTopics: t.saidInTopics ?? [],
      saidInCallParts: t.saidInCallParts ?? [],
      filterQuery: t.filterQuery ?? null,
      created: t.created ?? null,
      creatorUserId: t.creatorUserId ?? null,
      updated: t.updated ?? null,
      updaterUserId: t.updaterUserId ?? null,
    }))
    return {
      success: true,
      output: { trackers },
    }
  },

  outputs: {
    trackers: {
      type: 'array',
      description: 'List of keyword tracker definitions',
      items: {
        type: 'object',
        properties: {
          trackerId: { type: 'string', description: 'Unique identifier for the tracker' },
          trackerName: { type: 'string', description: 'Display name of the tracker' },
          workspaceId: {
            type: 'string',
            description: 'ID of the workspace containing the tracker',
          },
          languageKeywords: {
            type: 'array',
            description: 'Keywords organized by language',
            items: {
              type: 'object',
              properties: {
                language: {
                  type: 'string',
                  description:
                    'ISO 639-2/B language code ("mul" means keywords apply across all languages)',
                },
                keywords: {
                  type: 'array',
                  description: 'Words and phrases in the designated language',
                },
                includeRelatedForms: {
                  type: 'boolean',
                  description: 'Whether to include different word forms',
                },
              },
            },
          },
          affiliation: {
            type: 'string',
            description: 'Speaker affiliation filter: "Anyone", "Company", or "NonCompany"',
          },
          partOfQuestion: {
            type: 'boolean',
            description: 'Whether to track keywords only within questions',
          },
          saidAt: {
            type: 'string',
            description: 'Position in call: "Anytime", "First", or "Last"',
          },
          saidAtInterval: {
            type: 'number',
            description: 'Duration to search (in minutes or percentage)',
          },
          saidAtUnit: { type: 'string', description: 'Unit for saidAtInterval' },
          saidInTopics: {
            type: 'array',
            description: 'Topics where keywords should be detected',
          },
          saidInCallParts: {
            type: 'array',
            description: 'Specific call segments to monitor',
          },
          filterQuery: {
            type: 'string',
            description: 'JSON-formatted call filtering criteria',
          },
          created: {
            type: 'string',
            description: 'Creation timestamp in ISO-8601 format',
          },
          creatorUserId: {
            type: 'string',
            description: 'ID of the user who created the tracker (null for built-in trackers)',
          },
          updated: {
            type: 'string',
            description: 'Last modification timestamp in ISO-8601 format',
          },
          updaterUserId: {
            type: 'string',
            description: 'ID of the user who last modified the tracker',
          },
        },
      },
    },
  },
}
