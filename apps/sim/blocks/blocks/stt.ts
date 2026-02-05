import { STTIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import { createVersionedToolSelector, normalizeFileInput } from '@/blocks/utils'
import type { SttBlockResponse } from '@/tools/stt/types'

export const SttBlock: BlockConfig<SttBlockResponse> = {
  type: 'stt',
  name: 'Speech-to-Text',
  description: 'Convert speech to text using AI',
  hideFromToolbar: true,
  authMode: AuthMode.ApiKey,
  longDescription:
    'Transcribe audio and video files to text using leading AI providers. Supports multiple languages, timestamps, and speaker diarization.',
  docsLink: 'https://docs.sim.ai/tools/stt',
  category: 'tools',
  bgColor: '#181C1E',
  icon: STTIcon,

  subBlocks: [
    // Provider selection
    {
      id: 'provider',
      title: 'Provider',
      type: 'dropdown',
      options: [
        { label: 'OpenAI Whisper', id: 'whisper' },
        { label: 'Deepgram', id: 'deepgram' },
        { label: 'ElevenLabs', id: 'elevenlabs' },
        { label: 'AssemblyAI', id: 'assemblyai' },
        { label: 'Google Gemini', id: 'gemini' },
      ],
      value: () => 'whisper',
      required: true,
    },

    // OpenAI Whisper model selection
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'whisper' },
      options: [{ label: 'Whisper-1', id: 'whisper-1' }],
      value: () => 'whisper-1',
      required: true,
    },

    // ElevenLabs model selection
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'elevenlabs' },
      options: [
        { label: 'Scribe v1', id: 'scribe_v1' },
        { label: 'Scribe v1 Experimental', id: 'scribe_v1_experimental' },
      ],
      value: () => 'scribe_v1',
      required: true,
    },

    // Deepgram model selection
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'deepgram' },
      options: [
        { label: 'Nova 3', id: 'nova-3' },
        { label: 'Nova 2', id: 'nova-2' },
        { label: 'Nova', id: 'nova' },
        { label: 'Whisper Large', id: 'whisper-large' },
        { label: 'Enhanced', id: 'enhanced' },
        { label: 'Base', id: 'base' },
      ],
      value: () => 'nova-3',
      required: true,
    },

    // AssemblyAI model selection
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'assemblyai' },
      options: [{ label: 'Best', id: 'best' }],
      value: () => 'best',
      required: true,
    },

    // Gemini model selection
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      condition: { field: 'provider', value: 'gemini' },
      options: [
        { label: 'Gemini 3 Pro', id: 'gemini-3-pro-preview' },
        { label: 'Gemini 2.5 Pro', id: 'gemini-2.5-pro' },
        { label: 'Gemini 2.5 Flash', id: 'gemini-2.5-flash' },
        { label: 'Gemini 2.5 Flash Lite', id: 'gemini-2.5-flash-lite' },
        { label: 'Gemini 2.0 Flash', id: 'gemini-2.0-flash-exp' },
      ],
      value: () => 'gemini-2.5-flash',
      required: true,
    },

    // Audio/Video file upload (basic mode)
    {
      id: 'audioFile',
      title: 'Audio/Video File',
      type: 'file-upload',
      canonicalParamId: 'audioFile',
      placeholder: 'Upload an audio or video file',
      mode: 'basic',
      multiple: false,
      required: true,
      acceptedTypes: '.mp3,.m4a,.wav,.webm,.ogg,.flac,.aac,.opus,.mp4,.mov,.avi,.mkv',
    },

    // Audio file reference (advanced mode)
    {
      id: 'audioFileReference',
      title: 'Audio/Video File Reference',
      type: 'short-input',
      canonicalParamId: 'audioFile',
      placeholder: 'Reference audio/video from previous blocks',
      mode: 'advanced',
      required: true,
    },

    // Audio URL (alternative)
    {
      id: 'audioUrl',
      title: 'Audio/Video URL',
      type: 'short-input',
      placeholder: 'Or enter publicly accessible audio/video URL',
      required: false,
    },

    // Language selection
    {
      id: 'language',
      title: 'Language',
      type: 'dropdown',
      options: [
        { label: 'Auto-detect', id: 'auto' },
        { label: 'English', id: 'en' },
        { label: 'Spanish', id: 'es' },
        { label: 'French', id: 'fr' },
        { label: 'German', id: 'de' },
        { label: 'Italian', id: 'it' },
        { label: 'Portuguese', id: 'pt' },
        { label: 'Dutch', id: 'nl' },
        { label: 'Russian', id: 'ru' },
        { label: 'Chinese', id: 'zh' },
        { label: 'Japanese', id: 'ja' },
        { label: 'Korean', id: 'ko' },
        { label: 'Arabic', id: 'ar' },
        { label: 'Hindi', id: 'hi' },
        { label: 'Polish', id: 'pl' },
        { label: 'Turkish', id: 'tr' },
        { label: 'Swedish', id: 'sv' },
        { label: 'Danish', id: 'da' },
        { label: 'Norwegian', id: 'no' },
        { label: 'Finnish', id: 'fi' },
      ],
      value: () => 'auto',
      required: true,
    },

    // Timestamps (word-level, sentence-level, or none)
    {
      id: 'timestamps',
      title: 'Timestamps',
      type: 'dropdown',
      options: [
        { label: 'None', id: 'none' },
        { label: 'Sentence-level', id: 'sentence' },
        { label: 'Word-level', id: 'word' },
      ],
      value: () => 'none',
      required: true,
    },

    // Speaker diarization (Deepgram/AssemblyAI only)
    {
      id: 'diarization',
      title: 'Speaker Diarization',
      type: 'switch',
      condition: { field: 'provider', value: ['deepgram', 'assemblyai'] },
    },

    // Translate to English (Whisper only)
    {
      id: 'translateToEnglish',
      title: 'Translate to English',
      type: 'switch',
      condition: { field: 'provider', value: 'whisper' },
    },

    // AssemblyAI-specific features
    {
      id: 'sentiment',
      title: 'Sentiment Analysis',
      type: 'switch',
      condition: { field: 'provider', value: 'assemblyai' },
    },

    {
      id: 'entityDetection',
      title: 'Entity Detection',
      type: 'switch',
      condition: { field: 'provider', value: 'assemblyai' },
    },

    {
      id: 'piiRedaction',
      title: 'PII Redaction',
      type: 'switch',
      condition: { field: 'provider', value: 'assemblyai' },
    },

    {
      id: 'summarization',
      title: 'Auto Summarization',
      type: 'switch',
      condition: { field: 'provider', value: 'assemblyai' },
    },

    // API Key
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
    access: ['stt_whisper', 'stt_deepgram', 'stt_elevenlabs', 'stt_assemblyai', 'stt_gemini'],
    config: {
      tool: (params) => {
        // Select tool based on provider
        switch (params.provider) {
          case 'whisper':
            return 'stt_whisper'
          case 'deepgram':
            return 'stt_deepgram'
          case 'elevenlabs':
            return 'stt_elevenlabs'
          case 'assemblyai':
            return 'stt_assemblyai'
          case 'gemini':
            return 'stt_gemini'
          default:
            return 'stt_whisper'
        }
      },
      params: (params) => {
        // Normalize file input - audioFile is the canonical param for both basic and advanced modes
        const audioFile = normalizeFileInput(params.audioFile, {
          single: true,
        })

        return {
          provider: params.provider,
          apiKey: params.apiKey,
          model: params.model,
          audioFile,
          audioUrl: params.audioUrl,
          language: params.language,
          timestamps: params.timestamps,
          diarization: params.diarization,
          translateToEnglish: params.translateToEnglish,
          sentiment: params.sentiment,
          entityDetection: params.entityDetection,
          piiRedaction: params.piiRedaction,
          summarization: params.summarization,
        }
      },
    },
  },

  inputs: {
    provider: {
      type: 'string',
      description: 'STT provider (whisper, deepgram, elevenlabs, assemblyai, gemini)',
    },
    apiKey: { type: 'string', description: 'Provider API key' },
    model: {
      type: 'string',
      description:
        'Provider-specific model (e.g., scribe_v1 for ElevenLabs, nova-3 for Deepgram, best for AssemblyAI, gemini-2.0-flash-exp for Gemini)',
    },
    audioFile: { type: 'json', description: 'Audio/video file (UserFile)' },
    audioUrl: { type: 'string', description: 'Audio/video URL' },
    language: { type: 'string', description: 'Language code or auto' },
    timestamps: { type: 'string', description: 'Timestamp granularity (none, sentence, word)' },
    diarization: { type: 'boolean', description: 'Enable speaker diarization' },
    translateToEnglish: { type: 'boolean', description: 'Translate to English (Whisper only)' },
    sentiment: { type: 'boolean', description: 'Enable sentiment analysis (AssemblyAI only)' },
    entityDetection: { type: 'boolean', description: 'Enable entity detection (AssemblyAI only)' },
    piiRedaction: { type: 'boolean', description: 'Enable PII redaction (AssemblyAI only)' },
    summarization: { type: 'boolean', description: 'Enable auto summarization (AssemblyAI only)' },
  },

  outputs: {
    transcript: { type: 'string', description: 'Full transcribed text' },
    segments: {
      type: 'array',
      description: 'Timestamped segments with speaker labels',
      condition: { field: 'timestamps', value: 'none', not: true },
    },
    language: { type: 'string', description: 'Detected or specified language' },
    duration: { type: 'number', description: 'Audio duration in seconds' },
    confidence: {
      type: 'number',
      description: 'Overall confidence score',
      condition: { field: 'provider', value: ['deepgram', 'assemblyai', 'gemini'] },
    },
    sentiment: {
      type: 'array',
      description: 'Sentiment analysis results',
      condition: {
        field: 'provider',
        value: 'assemblyai',
        and: { field: 'sentiment', value: true },
      },
    },
    entities: {
      type: 'array',
      description: 'Detected entities',
      condition: {
        field: 'provider',
        value: 'assemblyai',
        and: { field: 'entityDetection', value: true },
      },
    },
    summary: {
      type: 'string',
      description: 'Auto-generated summary',
      condition: {
        field: 'provider',
        value: 'assemblyai',
        and: { field: 'summarization', value: true },
      },
    },
  },
}

const sttV2Inputs = SttBlock.inputs
  ? Object.fromEntries(Object.entries(SttBlock.inputs).filter(([key]) => key !== 'audioUrl'))
  : {}
const sttV2SubBlocks = (SttBlock.subBlocks || []).filter((subBlock) => subBlock.id !== 'audioUrl')

export const SttV2Block: BlockConfig<SttBlockResponse> = {
  ...SttBlock,
  type: 'stt_v2',
  name: 'Speech-to-Text',
  hideFromToolbar: false,
  subBlocks: sttV2SubBlocks,
  tools: {
    access: [
      'stt_whisper_v2',
      'stt_deepgram_v2',
      'stt_elevenlabs_v2',
      'stt_assemblyai_v2',
      'stt_gemini_v2',
    ],
    config: {
      tool: createVersionedToolSelector({
        baseToolSelector: (params) => {
          switch (params.provider) {
            case 'whisper':
              return 'stt_whisper'
            case 'deepgram':
              return 'stt_deepgram'
            case 'elevenlabs':
              return 'stt_elevenlabs'
            case 'assemblyai':
              return 'stt_assemblyai'
            case 'gemini':
              return 'stt_gemini'
            default:
              return 'stt_whisper'
          }
        },
        suffix: '_v2',
        fallbackToolId: 'stt_whisper_v2',
      }),
      params: (params) => {
        // Normalize file input - audioFile is the canonical param for both basic and advanced modes
        const audioFile = normalizeFileInput(params.audioFile, {
          single: true,
        })

        return {
          provider: params.provider,
          apiKey: params.apiKey,
          model: params.model,
          audioFile,
          language: params.language,
          timestamps: params.timestamps,
          diarization: params.diarization,
          translateToEnglish: params.translateToEnglish,
          sentiment: params.sentiment,
          entityDetection: params.entityDetection,
          piiRedaction: params.piiRedaction,
          summarization: params.summarization,
        }
      },
    },
  },
  inputs: sttV2Inputs,
}
