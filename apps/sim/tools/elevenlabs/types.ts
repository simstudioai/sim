import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export interface ElevenLabsTtsParams {
  apiKey: string
  text: string
  voiceId: string
  modelId?: string
  stability?: number
  similarityBoost?: number
}

export interface ElevenLabsTtsResponse extends ToolResponse {
  output: {
    audioUrl: string
    audioFile?: UserFile
  }
}

/** Voice settings shared by get/edit settings and embedded voice objects. */
export interface ElevenLabsVoiceSettings {
  stability?: number | null
  similarity_boost?: number | null
  style?: number | null
  use_speaker_boost?: boolean | null
  speed?: number | null
}

export interface ElevenLabsVoiceSummary {
  voiceId: string
  name: string | null
  category: string | null
  description: string | null
  labels: Record<string, string> | null
  previewUrl: string | null
  settings: ElevenLabsVoiceSettings | null
}

export interface ElevenLabsListVoicesParams {
  apiKey: string
  search?: string
  category?: string
  pageSize?: number
  nextPageToken?: string
}

export interface ElevenLabsListVoicesResponse extends ToolResponse {
  output: {
    voices: ElevenLabsVoiceSummary[]
    totalCount: number | null
    hasMore: boolean
    nextPageToken: string | null
  }
}

export interface ElevenLabsGetVoiceParams {
  apiKey: string
  voiceId: string
}

export interface ElevenLabsGetVoiceResponse extends ToolResponse {
  output: ElevenLabsVoiceSummary & {
    availableForTiers: string[]
    highQualityBaseModelIds: string[]
    isOwner: boolean | null
  }
}

export interface ElevenLabsGetVoiceSettingsParams {
  apiKey: string
  voiceId: string
}

export interface ElevenLabsGetVoiceSettingsResponse extends ToolResponse {
  output: {
    stability: number | null
    similarityBoost: number | null
    style: number | null
    useSpeakerBoost: boolean | null
    speed: number | null
  }
}

export interface ElevenLabsEditVoiceSettingsParams {
  apiKey: string
  voiceId: string
  stability?: number
  similarityBoost?: number
  style?: number
  useSpeakerBoost?: boolean
  speed?: number
}

export interface ElevenLabsEditVoiceSettingsResponse extends ToolResponse {
  output: {
    status: string
  }
}

export interface ElevenLabsModelLanguage {
  languageId: string | null
  name: string | null
}

export interface ElevenLabsModelSummary {
  modelId: string
  name: string | null
  description: string | null
  canDoTextToSpeech: boolean | null
  canDoVoiceConversion: boolean | null
  canUseStyle: boolean | null
  canUseSpeakerBoost: boolean | null
  languages: ElevenLabsModelLanguage[]
}

export interface ElevenLabsListModelsParams {
  apiKey: string
}

export interface ElevenLabsListModelsResponse extends ToolResponse {
  output: {
    models: ElevenLabsModelSummary[]
  }
}

export interface ElevenLabsGetUserParams {
  apiKey: string
}

export interface ElevenLabsGetUserResponse extends ToolResponse {
  output: {
    userId: string | null
    isNewUser: boolean | null
    subscription: {
      tier: string | null
      characterCount: number | null
      characterLimit: number | null
      canExtendCharacterLimit: boolean | null
      status: string | null
      nextCharacterCountResetUnix: number | null
    } | null
  }
}

export interface ElevenLabsSoundEffectsParams {
  apiKey: string
  text: string
  modelId?: string
  durationSeconds?: number
  promptInfluence?: number
  loop?: boolean
}

export interface ElevenLabsSpeechToSpeechParams {
  apiKey: string
  voiceId: string
  audioFile?: UserFile
  modelId?: string
  removeBackgroundNoise?: boolean
}

export interface ElevenLabsAudioIsolationParams {
  apiKey: string
  audioFile?: UserFile
}

export interface ElevenLabsAudioResponse extends ToolResponse {
  output: {
    audioUrl: string
    audioFile?: UserFile
  }
}

export type ElevenLabsBlockResponse =
  | ElevenLabsTtsResponse
  | ElevenLabsListVoicesResponse
  | ElevenLabsGetVoiceResponse
  | ElevenLabsGetVoiceSettingsResponse
  | ElevenLabsEditVoiceSettingsResponse
  | ElevenLabsListModelsResponse
  | ElevenLabsGetUserResponse
  | ElevenLabsAudioResponse
