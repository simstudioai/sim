import type { GongGetExtensiveCallsParams, GongGetExtensiveCallsResponse } from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const getExtensiveCallsTool: ToolConfig<
  GongGetExtensiveCallsParams,
  GongGetExtensiveCallsResponse
> = {
  id: 'gong_get_extensive_calls',
  name: 'Gong Get Extensive Calls',
  description: 'Retrieve detailed call data including trackers, topics, and highlights from Gong.',
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
    callIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of call IDs to retrieve detailed data for',
    },
    fromDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date/time filter in ISO-8601 format',
    },
    toDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date/time filter in ISO-8601 format',
    },
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Gong workspace ID to filter calls',
    },
    primaryUserIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of user IDs to filter calls by host',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: 'https://api.gong.io/v2/calls/extensive',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
    body: (params) => {
      const filter: Record<string, unknown> = {}
      if (params.callIds) {
        filter.callIds = params.callIds.split(',').map((id) => id.trim())
      }
      if (params.fromDateTime) filter.fromDateTime = params.fromDateTime
      if (params.toDateTime) filter.toDateTime = params.toDateTime
      if (params.workspaceId) filter.workspaceId = params.workspaceId
      if (params.primaryUserIds) {
        filter.primaryUserIds = params.primaryUserIds.split(',').map((id) => id.trim())
      }
      const body: Record<string, unknown> = {
        filter,
        contentSelector: {
          exposedFields: {
            parties: true,
            content: {
              structure: true,
              topics: true,
              trackers: true,
              trackerOccurrences: true,
              highlights: true,
            },
            collaboration: { publicComments: true },
            interaction: {
              personInteractionStats: true,
              speakers: true,
              video: true,
              questions: true,
            },
            media: true,
          },
        },
      }
      if (params.cursor) body.cursor = params.cursor
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(
        data.errors?.[0]?.message || data.message || 'Failed to get extensive call data'
      )
    }
    return {
      success: true,
      output: {
        calls: data.calls ?? [],
        cursor: data.records?.cursor ?? null,
      },
    }
  },

  outputs: {
    calls: {
      type: 'array',
      description:
        'List of detailed call objects with metadata, content, interaction stats, and collaboration data',
      items: {
        type: 'object',
        properties: {
          metaData: {
            type: 'object',
            description: 'Call metadata (same fields as CallBasicData)',
            properties: {
              id: { type: 'string', description: 'Call ID' },
              title: { type: 'string', description: 'Call title' },
              scheduled: { type: 'string', description: 'Scheduled time in ISO-8601' },
              started: { type: 'string', description: 'Start time in ISO-8601' },
              duration: { type: 'number', description: 'Duration in seconds' },
              direction: { type: 'string', description: 'Call direction' },
              system: { type: 'string', description: 'Communication platform' },
              scope: { type: 'string', description: 'Internal/External/Unknown' },
              media: { type: 'string', description: 'Media type' },
              language: { type: 'string', description: 'Language code (ISO-639-2B)' },
              url: { type: 'string', description: 'Gong web app URL' },
              primaryUserId: { type: 'string', description: 'Host user ID' },
              workspaceId: { type: 'string', description: 'Workspace ID' },
              sdrDisposition: { type: 'string', description: 'SDR disposition' },
              clientUniqueId: { type: 'string', description: 'Origin system call ID' },
              customData: { type: 'string', description: 'Custom metadata' },
              purpose: { type: 'string', description: 'Call purpose' },
              meetingUrl: { type: 'string', description: 'Meeting URL' },
              isPrivate: { type: 'boolean', description: 'Whether call is private' },
              calendarEventId: { type: 'string', description: 'Calendar event ID' },
            },
          },
          context: {
            type: 'array',
            description: 'Links to external systems (CRM, Dialer, etc.)',
            items: {
              type: 'object',
              properties: {
                system: { type: 'string', description: 'External system name (e.g., Salesforce)' },
                objects: {
                  type: 'array',
                  description: 'List of objects within the external system',
                },
              },
            },
          },
          parties: {
            type: 'array',
            description: 'List of call participants',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique participant ID in the call' },
                name: { type: 'string', description: 'Participant name' },
                emailAddress: { type: 'string', description: 'Email address' },
                title: { type: 'string', description: 'Job title' },
                phoneNumber: { type: 'string', description: 'Phone number' },
                speakerId: {
                  type: 'string',
                  description: 'Speaker ID for transcript cross-reference',
                },
                userId: { type: 'string', description: 'Gong user ID' },
                affiliation: { type: 'string', description: 'Company or non-company' },
                methods: { type: 'array', description: 'Whether invited or attended' },
                context: { type: 'array', description: 'Links to external systems for this party' },
              },
            },
          },
          content: {
            type: 'object',
            description: 'Call content data',
            properties: {
              structure: {
                type: 'array',
                description: 'Call agenda parts',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Agenda name' },
                    duration: { type: 'number', description: 'Duration of this part in seconds' },
                  },
                },
              },
              topics: {
                type: 'array',
                description: 'Topics and their durations',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Topic name (e.g., Pricing)' },
                    duration: { type: 'number', description: 'Time spent on topic in seconds' },
                  },
                },
              },
              trackers: {
                type: 'array',
                description: 'Trackers found in the call',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Tracker ID' },
                    name: { type: 'string', description: 'Tracker name' },
                    count: { type: 'number', description: 'Number of occurrences' },
                    type: { type: 'string', description: 'Keyword or Smart' },
                    occurrences: {
                      type: 'array',
                      description: 'Details for each occurrence',
                      items: {
                        type: 'object',
                        properties: {
                          speakerId: { type: 'string', description: 'Speaker who said it' },
                          startTime: { type: 'number', description: 'Seconds from call start' },
                        },
                      },
                    },
                    phrases: {
                      type: 'array',
                      description: 'Per-phrase occurrence counts',
                      items: {
                        type: 'object',
                        properties: {
                          phrase: { type: 'string', description: 'Specific phrase' },
                          count: { type: 'number', description: 'Occurrences of this phrase' },
                          occurrences: { type: 'array', description: 'Details per occurrence' },
                        },
                      },
                    },
                  },
                },
              },
              highlights: {
                type: 'array',
                description:
                  'AI-generated highlights including next steps, action items, and key moments',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string', description: 'Title of the highlight' },
                    items: {
                      type: 'array',
                      description: 'Individual highlight items',
                      items: {
                        type: 'object',
                        properties: {
                          text: { type: 'string', description: 'Text of the highlight item' },
                          startTimes: {
                            type: 'array',
                            description: 'Start times in seconds from call start',
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          interaction: {
            type: 'object',
            description: 'Interaction statistics',
            properties: {
              interactionStats: {
                type: 'array',
                description: 'Interaction stats per user',
                items: {
                  type: 'object',
                  properties: {
                    userId: { type: 'string', description: 'Gong user ID' },
                    userEmailAddress: { type: 'string', description: 'User email' },
                    personInteractionStats: {
                      type: 'array',
                      description: 'Stats list (Longest Monologue, Interactivity, Patience, etc.)',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', description: 'Stat name' },
                          value: { type: 'number', description: 'Stat value' },
                        },
                      },
                    },
                  },
                },
              },
              speakers: {
                type: 'array',
                description: 'Talk duration per speaker',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Participant ID' },
                    userId: { type: 'string', description: 'Gong user ID' },
                    talkTime: { type: 'number', description: 'Talk duration in seconds' },
                  },
                },
              },
              video: {
                type: 'array',
                description: 'Video statistics',
                items: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                      description:
                        'Segment type: Browser, Presentation, WebcamPrimaryUser, WebcamNonCompany, Webcam',
                    },
                    duration: { type: 'number', description: 'Total segment duration in seconds' },
                  },
                },
              },
              questions: {
                type: 'object',
                description: 'Question counts',
                properties: {
                  companyCount: { type: 'number', description: 'Questions by company speakers' },
                  nonCompanyCount: {
                    type: 'number',
                    description: 'Questions by non-company speakers',
                  },
                },
              },
            },
          },
          collaboration: {
            type: 'object',
            description: 'Collaboration data',
            properties: {
              publicComments: {
                type: 'array',
                description: 'Public comments on the call',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Comment ID' },
                    commenterUserId: { type: 'string', description: 'Commenter user ID' },
                    comment: { type: 'string', description: 'Comment text' },
                    posted: { type: 'string', description: 'Posted time in ISO-8601' },
                    audioStartTime: {
                      type: 'number',
                      description: 'Seconds from call start the comment refers to',
                    },
                    audioEndTime: {
                      type: 'number',
                      description: 'Seconds from call start the comment end refers to',
                    },
                    duringCall: {
                      type: 'boolean',
                      description: 'Whether the comment was posted during the call',
                    },
                    inReplyTo: {
                      type: 'string',
                      description: 'ID of original comment if this is a reply',
                    },
                  },
                },
              },
            },
          },
          media: {
            type: 'object',
            description: 'Media download URLs (available for 8 hours)',
            properties: {
              audioUrl: { type: 'string', description: 'Audio download URL' },
              videoUrl: { type: 'string', description: 'Video download URL' },
            },
          },
        },
      },
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for the next page',
      optional: true,
    },
  },
}
