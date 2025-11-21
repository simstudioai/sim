import { TTSIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { TtsBlockResponse } from '@/tools/tts/types'

export const TtsBlock: BlockConfig<TtsBlockResponse> = {
  type: 'tts',
  name: 'Text-to-Speech',
  description: 'Convert text to speech using AI voices',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Generate natural-sounding speech from text using state-of-the-art AI voices from OpenAI, Deepgram, ElevenLabs, Cartesia, Google Cloud, Azure, and PlayHT. Supports multiple voices, languages, and audio formats.',
  docsLink: 'https://docs.sim.ai/blocks/tts',
  category: 'tools',
  bgColor: '#181C1E',
  icon: TTSIcon,

  subBlocks: [
    // Provider selection
    {
      id: 'provider',
      title: 'Provider',
      type: 'dropdown',
      options: [
        { label: 'OpenAI TTS', id: 'openai' },
        { label: 'Deepgram Aura', id: 'deepgram' },
        { label: 'ElevenLabs', id: 'elevenlabs' },
        { label: 'Cartesia Sonic', id: 'cartesia' },
        { label: 'Google Cloud TTS', id: 'google' },
        { label: 'Azure TTS', id: 'azure' },
        { label: 'PlayHT', id: 'playht' },
      ],
      value: () => 'openai',
      required: true,
    },

    // Text input (common to all providers)
    {
      id: 'text',
      title: 'Text',
      type: 'long-input',
      placeholder: 'Enter the text to convert to speech...',
      required: true,
    },

    // OpenAI Model Selection
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'openai' },
      options: [
        { label: 'TTS-1 (Fast, good quality)', id: 'tts-1' },
        { label: 'TTS-1-HD (High definition)', id: 'tts-1-hd' },
        { label: 'GPT-4o Mini TTS (Enhanced)', id: 'gpt-4o-mini-tts' },
      ],
      value: () => 'tts-1',
      required: false,
    },

    // OpenAI Voice Selection
    {
      id: 'voice',
      title: 'Voice',
      type: 'dropdown',
      condition: { field: 'provider', value: 'openai' },
      options: [
        { label: 'Alloy (Neutral, balanced)', id: 'alloy' },
        { label: 'Echo (Warm, masculine)', id: 'echo' },
        { label: 'Fable (Soft, British accent)', id: 'fable' },
        { label: 'Onyx (Deep, authoritative)', id: 'onyx' },
        { label: 'Nova (Energetic, youthful)', id: 'nova' },
        { label: 'Shimmer (Warm, empathetic)', id: 'shimmer' },
        { label: 'Ash (Masculine, clear)', id: 'ash' },
        { label: 'Ballad (Smooth, melodic)', id: 'ballad' },
        { label: 'Coral (Warm, friendly)', id: 'coral' },
        { label: 'Sage (Calm, wise)', id: 'sage' },
        { label: 'Verse (Poetic, expressive)', id: 'verse' },
      ],
      value: () => 'alloy',
      required: false,
    },

    // OpenAI Response Format
    {
      id: 'responseFormat',
      title: 'Audio Format',
      type: 'dropdown',
      condition: { field: 'provider', value: 'openai' },
      options: [
        { label: 'MP3 (Recommended)', id: 'mp3' },
        { label: 'Opus (Low latency)', id: 'opus' },
        { label: 'AAC (Mobile-friendly)', id: 'aac' },
        { label: 'FLAC (Lossless)', id: 'flac' },
        { label: 'WAV (Uncompressed)', id: 'wav' },
      ],
      value: () => 'mp3',
      required: false,
    },

    // OpenAI Speed
    {
      id: 'speed',
      title: 'Speed',
      type: 'slider',
      condition: { field: 'provider', value: 'openai' },
      min: 0.25,
      max: 4.0,
      step: 0.25,
      value: () => '1.0',
      required: false,
    },

    // Deepgram Voice Selection
    {
      id: 'voice',
      title: 'Voice',
      type: 'dropdown',
      condition: { field: 'provider', value: 'deepgram' },
      options: [
        { label: 'Asteria (American, warm female)', id: 'aura-asteria-en' },
        { label: 'Luna (American, professional female)', id: 'aura-luna-en' },
        { label: 'Stella (American, energetic female)', id: 'aura-stella-en' },
        { label: 'Athena (British, sophisticated female)', id: 'aura-athena-en' },
        { label: 'Hera (American, mature female)', id: 'aura-hera-en' },
        { label: 'Orion (American, confident male)', id: 'aura-orion-en' },
        { label: 'Arcas (American, professional male)', id: 'aura-arcas-en' },
        { label: 'Perseus (American, strong male)', id: 'aura-perseus-en' },
        { label: 'Angus (Irish, friendly male)', id: 'aura-angus-en' },
        { label: 'Orpheus (American, smooth male)', id: 'aura-orpheus-en' },
        { label: 'Helios (British, authoritative male)', id: 'aura-helios-en' },
        { label: 'Zeus (American, deep male)', id: 'aura-zeus-en' },
      ],
      value: () => 'aura-asteria-en',
      required: true,
    },

    // Deepgram Encoding
    {
      id: 'encoding',
      title: 'Audio Format',
      type: 'dropdown',
      condition: { field: 'provider', value: 'deepgram' },
      options: [
        { label: 'MP3 (Recommended)', id: 'mp3' },
        { label: 'Opus (Low latency)', id: 'opus' },
        { label: 'AAC (Mobile-friendly)', id: 'aac' },
        { label: 'FLAC (Lossless)', id: 'flac' },
        { label: 'Linear16 (PCM)', id: 'linear16' },
      ],
      value: () => 'mp3',
      required: false,
    },

    // Deepgram Sample Rate
    {
      id: 'sampleRate',
      title: 'Sample Rate',
      type: 'dropdown',
      condition: { field: 'provider', value: 'deepgram' },
      options: [
        { label: '8000 Hz (Phone quality)', id: '8000' },
        { label: '16000 Hz (Standard)', id: '16000' },
        { label: '24000 Hz (High quality)', id: '24000' },
        { label: '48000 Hz (Studio quality)', id: '48000' },
      ],
      value: () => '24000',
      required: false,
    },

    // ElevenLabs Voice ID
    {
      id: 'voiceId',
      title: 'Voice ID',
      type: 'short-input',
      condition: { field: 'provider', value: 'elevenlabs' },
      placeholder: 'Enter ElevenLabs voice ID',
      required: true,
    },

    // ElevenLabs Model Selection
    {
      id: 'modelId',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'elevenlabs' },
      options: [
        { label: 'Turbo v2.5 (faster, recommended)', id: 'eleven_turbo_v2_5' },
        { label: 'Flash v2.5 (ultra-fast, 75ms)', id: 'eleven_flash_v2_5' },
        { label: 'Multilingual v2 (32 languages)', id: 'eleven_multilingual_v2' },
        { label: 'Turbo v2 (fast)', id: 'eleven_turbo_v2' },
        { label: 'Monolingual v1 (English only)', id: 'eleven_monolingual_v1' },
        { label: 'Multilingual v1', id: 'eleven_multilingual_v1' },
      ],
      value: () => 'eleven_turbo_v2_5',
      required: false,
    },

    // ElevenLabs Stability
    {
      id: 'stability',
      title: 'Stability',
      type: 'slider',
      condition: { field: 'provider', value: 'elevenlabs' },
      min: 0.0,
      max: 1.0,
      step: 0.05,
      value: () => '0.5',
      required: false,
    },

    // ElevenLabs Similarity Boost
    {
      id: 'similarityBoost',
      title: 'Similarity Boost',
      type: 'slider',
      condition: { field: 'provider', value: 'elevenlabs' },
      min: 0.0,
      max: 1.0,
      step: 0.05,
      value: () => '0.8',
      required: false,
    },

    // ElevenLabs Style
    {
      id: 'style',
      title: 'Style',
      type: 'slider',
      condition: { field: 'provider', value: 'elevenlabs' },
      min: 0.0,
      max: 1.0,
      step: 0.05,
      value: () => '0.0',
      required: false,
    },

    // Cartesia Model Selection
    {
      id: 'modelId',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'cartesia' },
      options: [
        { label: 'Sonic (English, low latency)', id: 'sonic' },
        { label: 'Sonic 2 (English, improved)', id: 'sonic-2' },
        { label: 'Sonic Turbo (English, ultra-fast)', id: 'sonic-turbo' },
        { label: 'Sonic 3 (English, highest quality)', id: 'sonic-3' },
        { label: 'Sonic Multilingual (100+ languages)', id: 'sonic-multilingual' },
      ],
      value: () => 'sonic-3',
      required: false,
    },

    // Cartesia Voice
    {
      id: 'voice',
      title: 'Voice ID',
      type: 'short-input',
      condition: { field: 'provider', value: 'cartesia' },
      placeholder: 'Enter Cartesia voice ID',
      required: true,
    },

    // Cartesia Speed
    {
      id: 'speed',
      title: 'Speed',
      type: 'slider',
      condition: { field: 'provider', value: 'cartesia' },
      min: 0.5,
      max: 2.0,
      step: 0.1,
      value: () => '1.0',
      required: false,
    },

    // Google Voice ID
    {
      id: 'voiceId',
      title: 'Voice ID',
      type: 'short-input',
      condition: { field: 'provider', value: 'google' },
      placeholder: 'e.g., en-US-Neural2-A',
      required: false,
    },

    // Google Language Code
    {
      id: 'languageCode',
      title: 'Language Code',
      type: 'short-input',
      condition: { field: 'provider', value: 'google' },
      placeholder: 'e.g., en-US, es-ES',
      required: false,
    },

    // Google Speaking Rate
    {
      id: 'speakingRate',
      title: 'Speaking Rate',
      type: 'slider',
      condition: { field: 'provider', value: 'google' },
      min: 0.25,
      max: 2.0,
      step: 0.25,
      value: () => '1.0',
      required: false,
    },

    // Google Pitch
    {
      id: 'pitch',
      title: 'Pitch',
      type: 'slider',
      condition: { field: 'provider', value: 'google' },
      min: -20.0,
      max: 20.0,
      step: 1.0,
      value: () => '0.0',
      required: false,
    },

    // Azure Voice ID
    {
      id: 'voiceId',
      title: 'Voice ID',
      type: 'short-input',
      condition: { field: 'provider', value: 'azure' },
      placeholder: 'e.g., en-US-JennyNeural',
      required: false,
    },

    // Azure Region
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      condition: { field: 'provider', value: 'azure' },
      placeholder: 'e.g., eastus, westus',
      required: false,
    },

    // Azure Output Format
    {
      id: 'outputFormat',
      title: 'Output Format',
      type: 'dropdown',
      condition: { field: 'provider', value: 'azure' },
      options: [
        { label: 'MP3 24kHz 48kbps', id: 'audio-24khz-48kbitrate-mono-mp3' },
        { label: 'MP3 24kHz 96kbps', id: 'audio-24khz-96kbitrate-mono-mp3' },
        { label: 'MP3 48kHz 96kbps (high quality)', id: 'audio-48khz-96kbitrate-mono-mp3' },
      ],
      value: () => 'audio-24khz-96kbitrate-mono-mp3',
      required: false,
    },

    // Azure Style
    {
      id: 'style',
      title: 'Speaking Style',
      type: 'short-input',
      condition: { field: 'provider', value: 'azure' },
      placeholder: 'e.g., cheerful, sad, angry',
      required: false,
    },

    // PlayHT User ID
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      condition: { field: 'provider', value: 'playht' },
      placeholder: 'Enter your PlayHT user ID',
      password: true,
      required: true,
    },

    // PlayHT Voice
    {
      id: 'voice',
      title: 'Voice',
      type: 'short-input',
      condition: { field: 'provider', value: 'playht' },
      placeholder: 'Voice ID or manifest URL',
      required: false,
    },

    // PlayHT Quality
    {
      id: 'quality',
      title: 'Quality',
      type: 'dropdown',
      condition: { field: 'provider', value: 'playht' },
      options: [
        { label: 'Draft (fastest)', id: 'draft' },
        { label: 'Standard (recommended)', id: 'standard' },
        { label: 'Premium (best quality)', id: 'premium' },
      ],
      value: () => 'standard',
      required: false,
    },

    // PlayHT Speed
    {
      id: 'speed',
      title: 'Speed',
      type: 'slider',
      condition: { field: 'provider', value: 'playht' },
      min: 0.5,
      max: 2.0,
      step: 0.1,
      value: () => '1.0',
      required: false,
    },

    // API Key (common to all providers)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your API key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: [
      'tts_openai',
      'tts_deepgram',
      'tts_elevenlabs',
      'tts_cartesia',
      'tts_google',
      'tts_azure',
      'tts_playht',
    ],
    config: {
      tool: (params) => {
        // Select tool based on provider
        switch (params.provider) {
          case 'openai':
            return 'tts_openai'
          case 'deepgram':
            return 'tts_deepgram'
          case 'elevenlabs':
            return 'tts_elevenlabs'
          case 'cartesia':
            return 'tts_cartesia'
          case 'google':
            return 'tts_google'
          case 'azure':
            return 'tts_azure'
          case 'playht':
            return 'tts_playht'
          default:
            return 'tts_openai'
        }
      },
      params: (params) => {
        const baseParams = {
          text: params.text,
          apiKey: params.apiKey,
        }

        if (params.provider === 'openai') {
          return {
            ...baseParams,
            model: params.model,
            voice: params.voice,
            responseFormat: params.responseFormat,
            speed: params.speed ? Number(params.speed) : undefined,
          }
        }

        if (params.provider === 'deepgram') {
          return {
            ...baseParams,
            voice: params.voice,
            encoding: params.encoding,
            sampleRate: params.sampleRate ? Number(params.sampleRate) : undefined,
          }
        }

        if (params.provider === 'elevenlabs') {
          return {
            ...baseParams,
            voiceId: params.voiceId,
            modelId: params.modelId,
            stability: params.stability ? Number(params.stability) : undefined,
            similarityBoost: params.similarityBoost ? Number(params.similarityBoost) : undefined,
            style: params.style ? Number(params.style) : undefined,
          }
        }

        if (params.provider === 'cartesia') {
          return {
            ...baseParams,
            modelId: params.modelId,
            voice: params.voice,
            speed: params.speed ? Number(params.speed) : undefined,
          }
        }

        if (params.provider === 'google') {
          return {
            ...baseParams,
            voiceId: params.voiceId,
            languageCode: params.languageCode,
            speakingRate: params.speakingRate ? Number(params.speakingRate) : undefined,
            pitch: params.pitch ? Number(params.pitch) : undefined,
          }
        }

        if (params.provider === 'azure') {
          return {
            ...baseParams,
            voiceId: params.voiceId,
            region: params.region,
            outputFormat: params.outputFormat,
            style: params.style,
          }
        }

        if (params.provider === 'playht') {
          return {
            ...baseParams,
            userId: params.userId,
            voice: params.voice,
            quality: params.quality,
            speed: params.speed ? Number(params.speed) : undefined,
          }
        }

        return baseParams
      },
    },
  },

  inputs: {
    provider: {
      type: 'string',
      description: 'TTS provider (openai, deepgram, elevenlabs, cartesia, google, azure, playht)',
    },
    text: { type: 'string', description: 'Text to convert to speech' },
    apiKey: { type: 'string', description: 'Provider API key' },
    // OpenAI
    model: { type: 'string', description: 'OpenAI model (tts-1, tts-1-hd, gpt-4o-mini-tts)' },
    voice: { type: 'string', description: 'Voice identifier' },
    responseFormat: { type: 'string', description: 'Audio format (mp3, opus, aac, flac, wav)' },
    speed: { type: 'number', description: 'Speech speed (0.25 to 4.0) or speed multiplier' },
    // Deepgram
    encoding: { type: 'string', description: 'Audio encoding' },
    sampleRate: { type: 'number', description: 'Sample rate in Hz' },
    // ElevenLabs
    voiceId: { type: 'string', description: 'Voice ID (ElevenLabs, Google, Azure)' },
    modelId: { type: 'string', description: 'Model ID (ElevenLabs, Cartesia)' },
    stability: { type: 'number', description: 'Voice stability (0.0 to 1.0)' },
    similarityBoost: { type: 'number', description: 'Similarity boost (0.0 to 1.0)' },
    style: { type: 'string', description: 'Style exaggeration or speaking style' },
    // Cartesia
    language: { type: 'string', description: 'Language code (Cartesia)' },
    // Google Cloud
    languageCode: { type: 'string', description: 'Language code (Google)' },
    speakingRate: { type: 'number', description: 'Speaking rate (Google)' },
    pitch: { type: 'number', description: 'Voice pitch (Google)' },
    // Azure
    region: { type: 'string', description: 'Azure region' },
    outputFormat: { type: 'string', description: 'Output audio format' },
    // PlayHT
    userId: { type: 'string', description: 'PlayHT user ID' },
    quality: { type: 'string', description: 'Quality level (PlayHT)' },
  },

  outputs: {
    audioUrl: { type: 'string', description: 'URL to the generated audio file' },
    audioFile: { type: 'json', description: 'Generated audio file object (UserFile)' },
    duration: { type: 'number', description: 'Audio duration in seconds' },
    characterCount: { type: 'number', description: 'Number of characters processed' },
    format: { type: 'string', description: 'Audio format' },
    provider: { type: 'string', description: 'TTS provider used' },
  },
}
