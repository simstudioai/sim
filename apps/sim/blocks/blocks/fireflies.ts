import { FirefliesIcon } from '@/components/icons'
import { resolveHttpsUrlFromFileInput } from '@/lib/uploads/utils/file-utils'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { FirefliesResponse } from '@/tools/fireflies/types'
import { getTrigger } from '@/triggers'

export const FirefliesBlock: BlockConfig<FirefliesResponse> = {
  type: 'fireflies',
  name: 'Fireflies (Legacy)',
  description: 'Interact with Fireflies.ai meeting transcripts and recordings',
  hideFromToolbar: true,
  authMode: AuthMode.ApiKey,
  triggerAllowed: true,
  longDescription:
    'Integrate Fireflies.ai into the workflow. Manage meeting transcripts, add bot to live meetings, create soundbites, and more. Can also trigger workflows when transcriptions complete.',
  docsLink: 'https://docs.sim.ai/tools/fireflies',
  category: 'tools',
  icon: FirefliesIcon,
  bgColor: '#100730',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Transcripts', id: 'fireflies_list_transcripts' },
        { label: 'Get Transcript', id: 'fireflies_get_transcript' },
        { label: 'Get User', id: 'fireflies_get_user' },
        { label: 'List Users', id: 'fireflies_list_users' },
        { label: 'Upload Audio', id: 'fireflies_upload_audio' },
        { label: 'Delete Transcript', id: 'fireflies_delete_transcript' },
        { label: 'Add Bot to Live Meeting', id: 'fireflies_add_to_live_meeting' },
        { label: 'Create Bite', id: 'fireflies_create_bite' },
        { label: 'List Bites', id: 'fireflies_list_bites' },
        { label: 'List Contacts', id: 'fireflies_list_contacts' },
      ],
      value: () => 'fireflies_list_transcripts',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Fireflies API key',
      password: true,
      required: true,
    },
    // Transcript ID (for get/delete/create_bite/list_bites)
    {
      id: 'transcriptId',
      title: 'Transcript ID',
      type: 'short-input',
      placeholder: 'Enter transcript ID',
      required: {
        field: 'operation',
        value: ['fireflies_get_transcript', 'fireflies_delete_transcript', 'fireflies_create_bite'],
      },
      condition: {
        field: 'operation',
        value: [
          'fireflies_get_transcript',
          'fireflies_delete_transcript',
          'fireflies_create_bite',
          'fireflies_list_bites',
        ],
      },
    },
    // User ID (optional for get user)
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Leave empty for current user',
      required: false,
      condition: {
        field: 'operation',
        value: 'fireflies_get_user',
      },
    },
    // List Transcripts filters
    {
      id: 'keyword',
      title: 'Keyword',
      type: 'short-input',
      placeholder: 'Search in title or transcript',
      required: false,
      condition: {
        field: 'operation',
        value: 'fireflies_list_transcripts',
      },
    },
    {
      id: 'fromDate',
      title: 'From Date',
      type: 'short-input',
      placeholder: 'e.g., 2024-01-01T00:00:00Z',
      required: false,
      condition: {
        field: 'operation',
        value: 'fireflies_list_transcripts',
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "yesterday" -> Calculate yesterday's date at 00:00:00Z
- "last week" -> Calculate 7 days ago at 00:00:00Z
- "beginning of this month" -> First day of current month at 00:00:00Z
- "January 1st 2024" -> 2024-01-01T00:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "last week", "beginning of this month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'toDate',
      title: 'To Date',
      type: 'short-input',
      placeholder: 'e.g., 2024-12-31T23:59:59Z',
      required: false,
      condition: {
        field: 'operation',
        value: 'fireflies_list_transcripts',
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "today" -> Calculate today's date at 23:59:59Z
- "end of this week" -> Calculate end of week at 23:59:59Z
- "end of this month" -> Last day of current month at 23:59:59Z
- "December 31st 2024" -> 2024-12-31T23:59:59Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "today", "end of this month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'hostEmail',
      title: 'Host Email',
      type: 'short-input',
      placeholder: 'Filter by host email',
      required: false,
      condition: {
        field: 'operation',
        value: 'fireflies_list_transcripts',
      },
    },
    {
      id: 'participants',
      title: 'Participants',
      type: 'short-input',
      placeholder: 'Comma-separated participant emails',
      required: false,
      condition: {
        field: 'operation',
        value: 'fireflies_list_transcripts',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max 50 (default: 50)',
      required: false,
      condition: {
        field: 'operation',
        value: ['fireflies_list_transcripts', 'fireflies_list_bites'],
      },
    },
    // Upload Audio fields - File upload (basic mode)
    {
      id: 'audioFile',
      title: 'Audio/Video File',
      type: 'file-upload',
      canonicalParamId: 'audioFile',
      placeholder: 'Upload an audio or video file',
      mode: 'basic',
      multiple: false,
      required: false,
      acceptedTypes: '.mp3,.m4a,.wav,.webm,.ogg,.flac,.aac,.opus,.mp4,.mov,.avi,.mkv',
      condition: {
        field: 'operation',
        value: 'fireflies_upload_audio',
      },
    },
    // Upload Audio fields - File reference (advanced mode)
    {
      id: 'audioFileReference',
      title: 'Audio/Video File Reference',
      type: 'short-input',
      canonicalParamId: 'audioFile',
      placeholder: 'Reference audio/video from previous blocks',
      mode: 'advanced',
      required: false,
      condition: {
        field: 'operation',
        value: 'fireflies_upload_audio',
      },
    },
    // Upload Audio fields - URL input
    {
      id: 'audioUrl',
      title: 'Audio/Video URL',
      type: 'short-input',
      placeholder: 'Or enter publicly accessible audio/video URL',
      description: 'Public HTTPS URL to audio file (MP3, MP4, WAV, M4A, OGG)',
      required: false,
      condition: {
        field: 'operation',
        value: 'fireflies_upload_audio',
      },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Meeting title',
      required: false,
      condition: {
        field: 'operation',
        value: ['fireflies_upload_audio', 'fireflies_add_to_live_meeting'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a clear, professional meeting title based on the user's description.
The title should be concise (3-8 words) and descriptive.

Examples:
- "weekly sync with engineering" -> "Weekly Engineering Team Sync"
- "discussing q1 roadmap" -> "Q1 Roadmap Planning Discussion"
- "interview with john for backend role" -> "Backend Engineer Interview - John"
- "customer demo for acme corp" -> "Product Demo - Acme Corp"

Return ONLY the title - no quotes, no explanations.`,
        placeholder:
          'Describe the meeting (e.g., "weekly team sync", "customer call with Acme")...',
      },
    },
    {
      id: 'language',
      title: 'Language',
      type: 'short-input',
      placeholder: 'e.g., es, de, fr (default: English)',
      required: false,
      condition: {
        field: 'operation',
        value: ['fireflies_upload_audio', 'fireflies_add_to_live_meeting'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Convert the language name to its ISO 639-1 two-letter code.

Examples:
- "Spanish" -> es
- "French" -> fr
- "German" -> de
- "Portuguese" -> pt
- "Japanese" -> ja
- "Chinese" -> zh
- "Korean" -> ko
- "Italian" -> it
- "Dutch" -> nl
- "Russian" -> ru

Return ONLY the two-letter language code - no explanations, no quotes.`,
        placeholder: 'Enter language name (e.g., "Spanish", "French")...',
      },
    },
    {
      id: 'attendees',
      title: 'Attendees',
      type: 'long-input',
      placeholder: '[{"displayName": "John", "email": "john@example.com"}]',
      description: 'JSON array of attendees',
      required: false,
      condition: {
        field: 'operation',
        value: 'fireflies_upload_audio',
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of attendees based on the user's description.
Each attendee should have "displayName" and "email" fields.

Examples:
- "John Smith at john@example.com" -> [{"displayName": "John Smith", "email": "john@example.com"}]
- "Alice (alice@test.com) and Bob (bob@test.com)" -> [{"displayName": "Alice", "email": "alice@test.com"}, {"displayName": "Bob", "email": "bob@test.com"}]
- "Sarah Johnson, sarah.j@company.org" -> [{"displayName": "Sarah Johnson", "email": "sarah.j@company.org"}]

Return ONLY the valid JSON array - no explanations, no markdown code blocks.`,
        placeholder:
          'Describe attendees (e.g., "John Smith at john@example.com and Jane Doe at jane@test.com")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'clientReferenceId',
      title: 'Reference ID',
      type: 'short-input',
      placeholder: 'Custom tracking ID',
      required: false,
      condition: {
        field: 'operation',
        value: 'fireflies_upload_audio',
      },
    },
    // Add to Live Meeting fields
    {
      id: 'meetingLink',
      title: 'Meeting Link',
      type: 'short-input',
      placeholder: 'https://zoom.us/j/... or https://meet.google.com/...',
      description: 'URL for Zoom, Google Meet, or Microsoft Teams meeting',
      required: true,
      condition: {
        field: 'operation',
        value: 'fireflies_add_to_live_meeting',
      },
    },
    {
      id: 'meetingPassword',
      title: 'Meeting Password',
      type: 'short-input',
      placeholder: 'Optional meeting password',
      password: true,
      required: false,
      condition: {
        field: 'operation',
        value: 'fireflies_add_to_live_meeting',
      },
    },
    {
      id: 'duration',
      title: 'Duration (minutes)',
      type: 'short-input',
      placeholder: '60 (15-120 minutes)',
      required: false,
      condition: {
        field: 'operation',
        value: 'fireflies_add_to_live_meeting',
      },
    },
    // Create Bite fields
    {
      id: 'startTime',
      title: 'Start Time (seconds)',
      type: 'short-input',
      placeholder: 'e.g., 30',
      required: true,
      condition: {
        field: 'operation',
        value: 'fireflies_create_bite',
      },
    },
    {
      id: 'endTime',
      title: 'End Time (seconds)',
      type: 'short-input',
      placeholder: 'e.g., 90',
      required: true,
      condition: {
        field: 'operation',
        value: 'fireflies_create_bite',
      },
    },
    {
      id: 'biteName',
      title: 'Bite Name',
      type: 'short-input',
      placeholder: 'Name for this highlight',
      required: false,
      condition: {
        field: 'operation',
        value: 'fireflies_create_bite',
      },
    },
    {
      id: 'biteSummary',
      title: 'Summary',
      type: 'long-input',
      placeholder: 'Brief description of the highlight',
      required: false,
      condition: {
        field: 'operation',
        value: 'fireflies_create_bite',
      },
      wandConfig: {
        enabled: true,
        prompt: `Write a concise, professional summary for a meeting highlight/soundbite based on the user's description.
The summary should be 1-2 sentences that capture the key point of the highlighted segment.

Guidelines:
- Be clear and concise
- Focus on the main topic or decision discussed
- Use professional language
- Avoid filler words

Return ONLY the summary text - no quotes, no labels.`,
        placeholder: 'Describe what this highlight is about...',
      },
    },
    // Trigger SubBlocks
    ...getTrigger('fireflies_transcription_complete').subBlocks,
  ],
  tools: {
    access: [
      'fireflies_list_transcripts',
      'fireflies_get_transcript',
      'fireflies_get_user',
      'fireflies_list_users',
      'fireflies_upload_audio',
      'fireflies_delete_transcript',
      'fireflies_add_to_live_meeting',
      'fireflies_create_bite',
      'fireflies_list_bites',
      'fireflies_list_contacts',
    ],
    config: {
      tool: (params) => {
        return params.operation || 'fireflies_list_transcripts'
      },
      params: (params) => {
        const baseParams: Record<string, unknown> = {
          apiKey: params.apiKey,
        }

        switch (params.operation) {
          case 'fireflies_list_transcripts':
            return {
              ...baseParams,
              keyword: params.keyword || undefined,
              fromDate: params.fromDate || undefined,
              toDate: params.toDate || undefined,
              hostEmail: params.hostEmail || undefined,
              participants: params.participants || undefined,
              limit: params.limit ? Number(params.limit) : undefined,
            }

          case 'fireflies_get_transcript':
            if (!params.transcriptId?.trim()) {
              throw new Error('Transcript ID is required.')
            }
            return {
              ...baseParams,
              transcriptId: params.transcriptId.trim(),
            }

          case 'fireflies_get_user':
            return {
              ...baseParams,
              userId: params.userId?.trim() || undefined,
            }

          case 'fireflies_list_users':
            return baseParams

          case 'fireflies_upload_audio': {
            // Support both file upload and URL - use canonical 'audioFile' param
            const audioUrl = params.audioUrl?.trim()
            const audioFile = params.audioFile

            if (!audioUrl && !audioFile) {
              throw new Error('Either audio file or audio URL is required.')
            }

            return {
              ...baseParams,
              audioUrl: audioUrl || undefined,
              audioFile: audioFile || undefined,
              title: params.title?.trim() || undefined,
              language: params.language?.trim() || undefined,
              attendees: params.attendees?.trim() || undefined,
              clientReferenceId: params.clientReferenceId?.trim() || undefined,
            }
          }

          case 'fireflies_delete_transcript':
            if (!params.transcriptId?.trim()) {
              throw new Error('Transcript ID is required.')
            }
            return {
              ...baseParams,
              transcriptId: params.transcriptId.trim(),
            }

          case 'fireflies_add_to_live_meeting':
            if (!params.meetingLink?.trim()) {
              throw new Error('Meeting link is required.')
            }
            return {
              ...baseParams,
              meetingLink: params.meetingLink.trim(),
              title: params.title?.trim() || undefined,
              meetingPassword: params.meetingPassword?.trim() || undefined,
              duration: params.duration ? Number(params.duration) : undefined,
              language: params.language?.trim() || undefined,
            }

          case 'fireflies_create_bite':
            if (!params.transcriptId?.trim()) {
              throw new Error('Transcript ID is required.')
            }
            if (!params.startTime || !params.endTime) {
              throw new Error('Start time and end time are required.')
            }
            return {
              ...baseParams,
              transcriptId: params.transcriptId.trim(),
              startTime: Number(params.startTime),
              endTime: Number(params.endTime),
              name: params.biteName?.trim() || undefined,
              summary: params.biteSummary?.trim() || undefined,
            }

          case 'fireflies_list_bites':
            return {
              ...baseParams,
              transcriptId: params.transcriptId?.trim() || undefined,
              mine: true,
              limit: params.limit ? Number(params.limit) : undefined,
            }

          case 'fireflies_list_contacts':
            return baseParams

          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Fireflies API key' },
    transcriptId: { type: 'string', description: 'Transcript identifier' },
    userId: { type: 'string', description: 'User identifier' },
    keyword: { type: 'string', description: 'Search keyword' },
    fromDate: { type: 'string', description: 'Filter from date (ISO 8601)' },
    toDate: { type: 'string', description: 'Filter to date (ISO 8601)' },
    hostEmail: { type: 'string', description: 'Filter by host email' },
    participants: { type: 'string', description: 'Filter by participants (comma-separated)' },
    limit: { type: 'number', description: 'Maximum results to return' },
    audioFile: { type: 'json', description: 'Audio/video file (canonical param)' },
    audioUrl: { type: 'string', description: 'Public URL to audio file' },
    title: { type: 'string', description: 'Meeting title' },
    language: { type: 'string', description: 'Language code for transcription' },
    attendees: { type: 'string', description: 'JSON array of attendees' },
    clientReferenceId: { type: 'string', description: 'Custom reference ID for tracking' },
    meetingLink: { type: 'string', description: 'Meeting URL (Zoom, Meet, Teams)' },
    meetingPassword: { type: 'string', description: 'Meeting password if required' },
    duration: { type: 'number', description: 'Meeting duration in minutes (15-120)' },
    startTime: { type: 'number', description: 'Bite start time in seconds' },
    endTime: { type: 'number', description: 'Bite end time in seconds' },
    biteName: { type: 'string', description: 'Name for the bite/highlight' },
    biteSummary: { type: 'string', description: 'Summary for the bite' },
  },
  outputs: {
    // List transcripts outputs
    transcripts: { type: 'json', description: 'List of transcripts' },
    count: { type: 'number', description: 'Number of transcripts returned' },
    // Get transcript outputs
    transcript: { type: 'json', description: 'Full transcript data with summary and analytics' },
    // User outputs
    user: { type: 'json', description: 'User information' },
    users: { type: 'json', description: 'List of team users' },
    // Bite outputs
    bite: { type: 'json', description: 'Created bite details' },
    bites: { type: 'json', description: 'List of bites/soundbites' },
    // Contact outputs
    contacts: { type: 'json', description: 'List of contacts from meetings' },
    // Common outputs
    success: { type: 'boolean', description: 'Operation success status' },
    message: { type: 'string', description: 'Status message' },
    // Trigger outputs
    meetingId: { type: 'string', description: 'Meeting/transcript ID from webhook' },
    eventType: { type: 'string', description: 'Webhook event type' },
    clientReferenceId: { type: 'string', description: 'Custom reference ID if set during upload' },
  },
  triggers: {
    enabled: true,
    available: ['fireflies_transcription_complete'],
  },
}

const firefliesV2SubBlocks = (FirefliesBlock.subBlocks || []).filter(
  (subBlock) => subBlock.id !== 'audioUrl'
)
const firefliesV2Inputs = FirefliesBlock.inputs
  ? Object.fromEntries(Object.entries(FirefliesBlock.inputs).filter(([key]) => key !== 'audioUrl'))
  : {}

export const FirefliesV2Block: BlockConfig<FirefliesResponse> = {
  ...FirefliesBlock,
  type: 'fireflies_v2',
  name: 'Fireflies',
  description: 'Interact with Fireflies.ai meeting transcripts and recordings',
  hideFromToolbar: false,
  subBlocks: firefliesV2SubBlocks,
  tools: {
    ...FirefliesBlock.tools,
    config: {
      ...FirefliesBlock.tools?.config,
      tool: (params) =>
        FirefliesBlock.tools?.config?.tool
          ? FirefliesBlock.tools.config.tool(params)
          : params.operation || 'fireflies_list_transcripts',
      params: (params) => {
        const baseParams = FirefliesBlock.tools?.config?.params
        if (!baseParams) {
          return params
        }

        if (params.operation === 'fireflies_upload_audio') {
          // Use canonical 'audioFile' param directly
          const audioFile = normalizeFileInput(params.audioFile, { single: true })
          if (!audioFile) {
            throw new Error('Audio file is required.')
          }
          const audioUrl = resolveHttpsUrlFromFileInput(audioFile)
          if (!audioUrl) {
            throw new Error('Audio file must include a https URL.')
          }

          return baseParams({
            ...params,
            audioUrl,
            audioFile: undefined,
          })
        }

        return baseParams(params)
      },
    },
  },
  inputs: firefliesV2Inputs,
}
