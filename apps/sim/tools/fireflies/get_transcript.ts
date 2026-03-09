import type {
  FirefliesGetTranscriptParams,
  FirefliesGetTranscriptResponse,
} from '@/tools/fireflies/types'
import type { ToolConfig } from '@/tools/types'

export const firefliesGetTranscriptTool: ToolConfig<
  FirefliesGetTranscriptParams,
  FirefliesGetTranscriptResponse
> = {
  id: 'fireflies_get_transcript',
  name: 'Fireflies Get Transcript',
  description:
    'Get a single transcript with full details including summary, action items, and analytics',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Fireflies API key',
    },
    transcriptId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The transcript ID to retrieve (e.g., "abc123def456")',
    },
  },

  request: {
    url: 'https://api.fireflies.ai/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.apiKey) {
        throw new Error('Missing API key for Fireflies API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }
    },
    body: (params) => ({
      query: `
        query Transcript($id: String!) {
          transcript(id: $id) {
            id
            title
            date
            dateString
            duration
            privacy
            transcript_url
            audio_url
            video_url
            meeting_link
            host_email
            organizer_email
            participants
            fireflies_users
            speakers {
              id
              name
            }
            meeting_attendees {
              displayName
              email
              phoneNumber
              name
              location
            }
            sentences {
              index
              speaker_name
              speaker_id
              text
              raw_text
              start_time
              end_time
              ai_filters {
                task
                pricing
                metric
                question
                date_and_time
                sentiment
              }
            }
            summary {
              keywords
              action_items
              outline
              shorthand_bullet
              overview
              bullet_gist
              gist
              short_summary
              short_overview
              meeting_type
              topics_discussed
            }
            analytics {
              sentiments {
                negative_pct
                neutral_pct
                positive_pct
              }
              categories {
                questions
                date_times
                metrics
                tasks
              }
              speakers {
                speaker_id
                name
                duration
                word_count
                longest_monologue
                monologues_count
                filler_words
                questions
                duration_pct
                words_per_minute
              }
            }
          }
        }
      `,
      variables: {
        id: params.transcriptId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to fetch transcript',
        output: {},
      }
    }

    const transcript = data.data?.transcript
    if (!transcript) {
      return {
        success: false,
        error: 'Transcript not found',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        transcript: {
          id: transcript.id,
          title: transcript.title,
          date: transcript.date,
          dateString: transcript.dateString,
          duration: transcript.duration,
          privacy: transcript.privacy,
          transcript_url: transcript.transcript_url,
          audio_url: transcript.audio_url,
          video_url: transcript.video_url,
          meeting_link: transcript.meeting_link,
          host_email: transcript.host_email,
          organizer_email: transcript.organizer_email,
          participants: transcript.participants,
          fireflies_users: transcript.fireflies_users,
          speakers: transcript.speakers,
          meeting_attendees: transcript.meeting_attendees,
          sentences: transcript.sentences,
          summary: transcript.summary,
          analytics: transcript.analytics,
        },
      },
    }
  },

  outputs: {
    transcript: {
      type: 'object',
      description: 'The transcript with full details',
      properties: {
        id: { type: 'string', description: 'Transcript ID' },
        title: { type: 'string', description: 'Meeting title' },
        date: { type: 'number', description: 'Meeting timestamp' },
        duration: { type: 'number', description: 'Meeting duration in seconds' },
        transcript_url: { type: 'string', description: 'URL to view transcript' },
        audio_url: { type: 'string', description: 'URL to audio recording' },
        host_email: { type: 'string', description: 'Host email address' },
        participants: { type: 'array', description: 'List of participant emails' },
        speakers: { type: 'array', description: 'List of speakers' },
        sentences: { type: 'array', description: 'Transcript sentences' },
        summary: { type: 'object', description: 'Meeting summary and action items' },
        analytics: { type: 'object', description: 'Meeting analytics and sentiment' },
      },
    },
  },
}
