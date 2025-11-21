import { AudioWaveformIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { SttBlockResponse } from '@/tools/stt/types'

export const SttBlock: BlockConfig<SttBlockResponse> = {
  type: 'stt',
  name: 'Speech-to-Text',
  description: 'Convert speech to text using AI',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Transcribe audio and video files to text using leading AI providers. Supports multiple languages, timestamps, and speaker diarization.',
  docsLink: 'https://docs.sim.ai/tools/stt',
  category: 'tools',
  bgColor: '#181C1E',
  icon: AudioWaveformIcon,

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
      options: [
        { label: 'Best (Recommended)', id: 'best' },
        { label: 'Nano (Fast)', id: 'nano' },
      ],
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
        { label: 'Gemini 2.0 Flash (Recommended)', id: 'gemini-2.0-flash-exp' },
        { label: 'Gemini 2.5 Flash', id: 'gemini-2.5-flash' },
        { label: 'Gemini 2.5 Pro', id: 'gemini-2.5-pro' },
      ],
      value: () => 'gemini-2.0-flash-exp',
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
      title: 'Audio/Video URL (alternative)',
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
      params: (params) => ({
        provider: params.provider,
        apiKey: params.apiKey,
        model: params.model,
        audioFile: params.audioFile,
        audioFileReference: params.audioFileReference,
        audioUrl: params.audioUrl,
        language: params.language,
        timestamps: params.timestamps,
        diarization: params.diarization,
        translateToEnglish: params.translateToEnglish,
        sentiment: params.sentiment,
        entityDetection: params.entityDetection,
        piiRedaction: params.piiRedaction,
        summarization: params.summarization,
      }),
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
    audioFileReference: { type: 'json', description: 'Audio/video file reference' },
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
    segments: { type: 'array', description: 'Timestamped segments with speaker labels' },
    language: { type: 'string', description: 'Detected or specified language' },
    duration: { type: 'number', description: 'Audio duration in seconds' },
    confidence: {
      type: 'number',
      description: 'Overall confidence score (Deepgram, AssemblyAI only)',
    },
    sentiment: { type: 'array', description: 'Sentiment analysis results (AssemblyAI only)' },
    entities: { type: 'array', description: 'Detected entities (AssemblyAI only)' },
    summary: { type: 'string', description: 'Auto-generated summary (AssemblyAI only)' },
  },
}
