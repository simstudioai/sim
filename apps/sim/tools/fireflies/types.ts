import type { ToolResponse } from '@/tools/types'
export interface FirefliesTranscript {
  id: string
  title: string
  date: number
  dateString?: string
  duration: number
  privacy?: string
  transcript_url?: string
  audio_url?: string
  video_url?: string
  meeting_link?: string
  host_email?: string
  organizer_email?: string
  participants?: string[]
  fireflies_users?: string[]
  speakers?: FirefliesSpeaker[]
  meeting_attendees?: FirefliesAttendee[]
  sentences?: FirefliesSentence[]
  summary?: FirefliesSummary
  analytics?: FirefliesAnalytics
}

export interface FirefliesSpeaker {
  id: string
  name: string
}

export interface FirefliesAttendee {
  displayName?: string
  email?: string
  phoneNumber?: string
  name?: string
  location?: string
}

export interface FirefliesSentence {
  index: number
  speaker_name?: string
  speaker_id?: string
  text: string
  raw_text?: string
  start_time: number
  end_time: number
  ai_filters?: {
    task?: boolean
    pricing?: boolean
    metric?: boolean
    question?: boolean
    date_and_time?: boolean
    text_cleanup?: string
    sentiment?: string
  }
}

export interface FirefliesSummary {
  keywords?: string[]
  action_items?: string[]
  outline?: string[]
  shorthand_bullet?: string[]
  overview?: string
  bullet_gist?: string[]
  gist?: string
  short_summary?: string
  short_overview?: string
  meeting_type?: string
  topics_discussed?: string[]
  transcript_chapters?: Array<{
    title?: string
    start_time?: number
    end_time?: number
  }>
}

export interface FirefliesAnalytics {
  sentiments?: {
    negative_pct?: number
    neutral_pct?: number
    positive_pct?: number
  }
  categories?: {
    questions?: number
    date_times?: number
    metrics?: number
    tasks?: number
  }
  speakers?: FirefliesSpeakerAnalytics[]
}

export interface FirefliesSpeakerAnalytics {
  speaker_id?: string
  name?: string
  duration?: number
  word_count?: number
  longest_monologue?: number
  monologues_count?: number
  filler_words?: number
  questions?: number
  duration_pct?: number
  words_per_minute?: number
}

export interface FirefliesUser {
  user_id: string
  name: string
  email: string
  integrations?: string[]
  is_admin?: boolean
  minutes_consumed?: number
  num_transcripts?: number
  recent_transcript?: string
  recent_meeting?: string
}

export interface FirefliesListTranscriptsParams {
  apiKey: string
  keyword?: string
  fromDate?: string
  toDate?: string
  hostEmail?: string
  participants?: string
  limit?: number
  skip?: number
}

export interface FirefliesGetTranscriptParams {
  apiKey: string
  transcriptId: string
}

export interface FirefliesGetUserParams {
  apiKey: string
  userId?: string
}

export interface FirefliesUploadAudioParams {
  apiKey: string
  audioUrl?: string
  audioFile?: {
    url?: string
    path?: string
    name?: string
    size?: number
    type?: string
    key?: string
  }
  title?: string
  webhook?: string
  language?: string
  attendees?: string
  clientReferenceId?: string
}

export interface FirefliesDeleteTranscriptParams {
  apiKey: string
  transcriptId: string
}

export interface FirefliesAddToLiveMeetingParams {
  apiKey: string
  meetingLink: string
  title?: string
  meetingPassword?: string
  duration?: number
  language?: string
}

export interface FirefliesListUsersParams {
  apiKey: string
}

export interface FirefliesCreateBiteParams {
  apiKey: string
  transcriptId: string
  startTime: number
  endTime: number
  name?: string
  mediaType?: string
  summary?: string
}

export interface FirefliesListBitesParams {
  apiKey: string
  transcriptId?: string
  mine?: boolean
  limit?: number
  skip?: number
}

export interface FirefliesListContactsParams {
  apiKey: string
}

export interface FirefliesListTranscriptsResponse extends ToolResponse {
  output: {
    transcripts?: Array<{
      id: string
      title: string
      date: number
      duration: number
      host_email?: string
      participants?: string[]
    }>
    count?: number
  }
}

export interface FirefliesGetTranscriptResponse extends ToolResponse {
  output: {
    transcript?: FirefliesTranscript
  }
}

export interface FirefliesGetUserResponse extends ToolResponse {
  output: {
    user?: FirefliesUser
  }
}

export interface FirefliesUploadAudioResponse extends ToolResponse {
  output: {
    success?: boolean
    title?: string
    message?: string
  }
}

export interface FirefliesDeleteTranscriptResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface FirefliesAddToLiveMeetingResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface FirefliesListUsersResponse extends ToolResponse {
  output: {
    users?: FirefliesUser[]
  }
}

export interface FirefliesBite {
  id: string
  name?: string
  transcript_id?: string
  user_id?: string
  start_time?: number
  end_time?: number
  status?: string
  summary?: string
  media_type?: string
  thumbnail?: string
  preview?: string
  created_at?: string
}

export interface FirefliesCreateBiteResponse extends ToolResponse {
  output: {
    bite?: {
      id: string
      name?: string
      status?: string
    }
  }
}

export interface FirefliesListBitesResponse extends ToolResponse {
  output: {
    bites?: FirefliesBite[]
  }
}

export interface FirefliesContact {
  email?: string
  name?: string
  picture?: string
  last_meeting_date?: string
}

export interface FirefliesListContactsResponse extends ToolResponse {
  output: {
    contacts?: FirefliesContact[]
  }
}

export type FirefliesResponse =
  | FirefliesListTranscriptsResponse
  | FirefliesGetTranscriptResponse
  | FirefliesGetUserResponse
  | FirefliesUploadAudioResponse
  | FirefliesDeleteTranscriptResponse
  | FirefliesAddToLiveMeetingResponse
  | FirefliesListUsersResponse
  | FirefliesCreateBiteResponse
  | FirefliesListBitesResponse
  | FirefliesListContactsResponse
