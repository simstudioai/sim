import { createLogger } from '@sim/logger'
import { FirefliesIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate } from '@/connectors/utils'

const logger = createLogger('FirefliesConnector')

const FIREFLIES_GRAPHQL_URL = 'https://api.fireflies.ai/graphql'
const TRANSCRIPTS_PER_PAGE = 50

interface FirefliesTranscript {
  id: string
  title: string
  date: number
  duration: number
  host_email?: string
  organizer_email?: string
  participants?: string[]
  transcript_url?: string
  speakers?: { id: number; name: string }[]
  sentences?: { index: number; speaker_name: string; text: string }[]
  summary?: {
    keywords?: string[]
    action_items?: string
    overview?: string
    short_summary?: string
  }
}

/**
 * Executes a GraphQL query against the Fireflies API.
 */
async function firefliesGraphQL(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<Record<string, unknown>> {
  const response = await fetchWithRetry(
    FIREFLIES_GRAPHQL_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query, variables }),
    },
    retryOptions
  )

  if (!response.ok) {
    throw new Error(`Fireflies API HTTP error: ${response.status}`)
  }

  const data = await response.json()

  if (data.errors) {
    const message = (data.errors as { message: string }[])[0]?.message || 'Unknown GraphQL error'
    throw new Error(`Fireflies API error: ${message}`)
  }

  return data.data as Record<string, unknown>
}

/**
 * Formats transcript sentences into plain text content.
 */
function formatTranscriptContent(transcript: FirefliesTranscript): string {
  const parts: string[] = []

  if (transcript.title) {
    parts.push(`Meeting: ${transcript.title}`)
  }

  if (transcript.date) {
    parts.push(`Date: ${new Date(transcript.date).toISOString()}`)
  }

  if (transcript.duration) {
    const minutes = Math.round(transcript.duration / 60)
    parts.push(`Duration: ${minutes} minutes`)
  }

  if (transcript.host_email) {
    parts.push(`Host: ${transcript.host_email}`)
  }

  if (transcript.participants && transcript.participants.length > 0) {
    parts.push(`Participants: ${transcript.participants.join(', ')}`)
  }

  if (transcript.summary?.overview) {
    parts.push('')
    parts.push('--- Overview ---')
    parts.push(transcript.summary.overview)
  }

  if (transcript.summary?.action_items) {
    parts.push('')
    parts.push('--- Action Items ---')
    parts.push(transcript.summary.action_items)
  }

  if (transcript.summary?.keywords && transcript.summary.keywords.length > 0) {
    parts.push('')
    parts.push(`Keywords: ${transcript.summary.keywords.join(', ')}`)
  }

  if (transcript.sentences && transcript.sentences.length > 0) {
    parts.push('')
    parts.push('--- Transcript ---')
    for (const sentence of transcript.sentences) {
      parts.push(`${sentence.speaker_name}: ${sentence.text}`)
    }
  }

  return parts.join('\n')
}

export const firefliesConnector: ConnectorConfig = {
  id: 'fireflies',
  name: 'Fireflies',
  description: 'Sync meeting transcripts from Fireflies.ai into your knowledge base',
  version: '1.0.0',
  icon: FirefliesIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Fireflies API key',
  },

  configFields: [
    {
      id: 'hostEmail',
      title: 'Filter by Host Email',
      type: 'short-input',
      placeholder: 'e.g. john@example.com',
      required: false,
      description: 'Only sync transcripts hosted by this email',
    },
    {
      id: 'maxTranscripts',
      title: 'Max Transcripts',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 100 (default: unlimited)',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const hostEmail = (sourceConfig.hostEmail as string) || ''
    const maxTranscripts = sourceConfig.maxTranscripts ? Number(sourceConfig.maxTranscripts) : 0

    const skip = cursor ? Number(cursor) : 0

    const variables: Record<string, unknown> = {
      limit: TRANSCRIPTS_PER_PAGE,
      skip,
    }

    if (hostEmail.trim()) {
      variables.host_email = hostEmail.trim()
    }

    logger.info('Listing Fireflies transcripts', { skip, limit: TRANSCRIPTS_PER_PAGE, hostEmail })

    const data = await firefliesGraphQL(
      accessToken,
      `query Transcripts(
        $limit: Int
        $skip: Int
        $host_email: String
      ) {
        transcripts(
          limit: $limit
          skip: $skip
          host_email: $host_email
        ) {
          id
          title
          date
          duration
          host_email
          organizer_email
          participants
          transcript_url
          speakers {
            id
            name
          }
        }
      }`,
      variables
    )

    const transcripts = (data.transcripts || []) as FirefliesTranscript[]

    const documents: ExternalDocument[] = transcripts.map((transcript) => {
      const meetingDate = transcript.date ? new Date(transcript.date).toISOString() : undefined
      const speakerNames = transcript.speakers?.map((s) => s.name).filter(Boolean) ?? []

      return {
        externalId: transcript.id,
        title: transcript.title || 'Untitled Meeting',
        content: '',
        contentDeferred: true,
        mimeType: 'text/plain' as const,
        sourceUrl: transcript.transcript_url || undefined,
        contentHash: `fireflies:${transcript.id}:${transcript.date ?? ''}:${transcript.duration ?? ''}`,
        metadata: {
          hostEmail: transcript.host_email,
          duration: transcript.duration,
          meetingDate,
          participants: transcript.participants,
          speakers: speakerNames,
        },
      }
    })

    const totalFetched = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxTranscripts > 0 && totalFetched >= maxTranscripts

    const hasMore = !hitLimit && transcripts.length === TRANSCRIPTS_PER_PAGE

    return {
      documents,
      nextCursor: hasMore ? String(skip + transcripts.length) : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    try {
      const data = await firefliesGraphQL(
        accessToken,
        `query Transcript($id: String!) {
          transcript(id: $id) {
            id
            title
            date
            duration
            host_email
            organizer_email
            participants
            transcript_url
            speakers {
              id
              name
            }
            sentences {
              index
              speaker_name
              text
            }
            summary {
              keywords
              action_items
              overview
              short_summary
            }
          }
        }`,
        { id: externalId }
      )

      const transcript = data.transcript as FirefliesTranscript | null
      if (!transcript) return null

      const content = formatTranscriptContent(transcript)
      const contentHash = `fireflies:${transcript.id}:${transcript.date ?? ''}:${transcript.duration ?? ''}`

      const meetingDate = transcript.date ? new Date(transcript.date).toISOString() : undefined
      const speakerNames = transcript.speakers?.map((s) => s.name).filter(Boolean) ?? []

      return {
        externalId: transcript.id,
        title: transcript.title || 'Untitled Meeting',
        content,
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: transcript.transcript_url || undefined,
        contentHash,
        metadata: {
          hostEmail: transcript.host_email,
          duration: transcript.duration,
          meetingDate,
          participants: transcript.participants,
          speakers: speakerNames,
          keywords: transcript.summary?.keywords,
        },
      }
    } catch (error) {
      logger.warn('Failed to get Fireflies transcript', {
        externalId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const maxTranscripts = sourceConfig.maxTranscripts as string | undefined
    if (maxTranscripts && (Number.isNaN(Number(maxTranscripts)) || Number(maxTranscripts) < 0)) {
      return { valid: false, error: 'Max transcripts must be a non-negative number' }
    }

    try {
      await firefliesGraphQL(
        accessToken,
        `query User {
          user {
            user_id
            name
            email
          }
        }`,
        {},
        VALIDATE_RETRY_OPTIONS
      )

      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'hostEmail', displayName: 'Host Email', fieldType: 'text' },
    { id: 'speakers', displayName: 'Speakers', fieldType: 'text' },
    { id: 'duration', displayName: 'Duration (seconds)', fieldType: 'number' },
    { id: 'meetingDate', displayName: 'Meeting Date', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.hostEmail === 'string') {
      result.hostEmail = metadata.hostEmail
    }

    const speakers = Array.isArray(metadata.speakers) ? (metadata.speakers as string[]) : []
    if (speakers.length > 0) {
      result.speakers = speakers.join(', ')
    }

    if (metadata.duration != null) {
      const num = Number(metadata.duration)
      if (!Number.isNaN(num)) result.duration = num
    }

    const meetingDate = parseTagDate(metadata.meetingDate)
    if (meetingDate) result.meetingDate = meetingDate

    return result
  },
}
