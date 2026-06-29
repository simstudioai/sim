import { ElevenLabsIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { ElevenLabsBlockResponse } from '@/tools/elevenlabs/types'

const VOICE_OPERATIONS = [
  'tts',
  'speech_to_speech',
  'get_voice',
  'get_voice_settings',
  'edit_voice_settings',
]
const AUDIO_INPUT_OPERATIONS = ['speech_to_speech', 'audio_isolation']

const toNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const toBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value
  return String(value).toLowerCase() === 'true'
}

export const ElevenLabsBlock: BlockConfig<ElevenLabsBlockResponse> = {
  type: 'elevenlabs',
  name: 'ElevenLabs',
  description: 'Generate and transform audio with ElevenLabs',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate ElevenLabs into the workflow. Convert text to speech, generate sound effects, transform voices, isolate audio, and manage voices, models, and account settings.',
  docsLink: 'https://docs.sim.ai/integrations/elevenlabs',
  category: 'tools',
  integrationType: IntegrationType.AI,
  bgColor: '#181C1E',
  icon: ElevenLabsIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Text to Speech', id: 'tts' },
        { label: 'Sound Effects', id: 'sound_effects' },
        { label: 'Speech to Speech', id: 'speech_to_speech' },
        { label: 'Audio Isolation', id: 'audio_isolation' },
        { label: 'List Voices', id: 'list_voices' },
        { label: 'Get Voice', id: 'get_voice' },
        { label: 'Get Voice Settings', id: 'get_voice_settings' },
        { label: 'Edit Voice Settings', id: 'edit_voice_settings' },
        { label: 'List Models', id: 'list_models' },
        { label: 'Get User Info', id: 'get_user' },
      ],
      value: () => 'tts',
      required: true,
    },

    {
      id: 'text',
      title: 'Text',
      type: 'long-input',
      placeholder: 'Enter the text to convert to speech',
      condition: { field: 'operation', value: 'tts' },
      required: { field: 'operation', value: 'tts' },
    },
    {
      id: 'text',
      title: 'Sound Prompt',
      type: 'long-input',
      placeholder: 'Describe the sound effect (e.g., "thunder rumbling in the distance")',
      condition: { field: 'operation', value: 'sound_effects' },
      required: { field: 'operation', value: 'sound_effects' },
    },

    {
      id: 'voiceId',
      title: 'Voice ID',
      type: 'short-input',
      placeholder: 'Enter the voice ID',
      condition: { field: 'operation', value: VOICE_OPERATIONS },
      required: { field: 'operation', value: VOICE_OPERATIONS },
    },

    {
      id: 'audioFile',
      title: 'Audio File',
      type: 'file-upload',
      placeholder: 'Upload an audio file',
      multiple: false,
      acceptedTypes: '.mp3,.m4a,.wav,.webm,.ogg,.flac,.aac,.opus',
      condition: { field: 'operation', value: AUDIO_INPUT_OPERATIONS },
      required: { field: 'operation', value: AUDIO_INPUT_OPERATIONS },
    },

    {
      id: 'modelId',
      title: 'Model ID',
      type: 'dropdown',
      options: [
        { label: 'eleven_monolingual_v1', id: 'eleven_monolingual_v1' },
        { label: 'eleven_multilingual_v2', id: 'eleven_multilingual_v2' },
        { label: 'eleven_turbo_v2', id: 'eleven_turbo_v2' },
        { label: 'eleven_turbo_v2_5', id: 'eleven_turbo_v2_5' },
        { label: 'eleven_flash_v2_5', id: 'eleven_flash_v2_5' },
        { label: 'eleven_v3', id: 'eleven_v3' },
      ],
      value: () => 'eleven_monolingual_v1',
      condition: { field: 'operation', value: 'tts' },
    },
    {
      id: 'modelId',
      title: 'Model ID',
      type: 'dropdown',
      options: [{ label: 'eleven_text_to_sound_v2', id: 'eleven_text_to_sound_v2' }],
      value: () => 'eleven_text_to_sound_v2',
      condition: { field: 'operation', value: 'sound_effects' },
    },
    {
      id: 'modelId',
      title: 'Model ID',
      type: 'dropdown',
      options: [
        { label: 'eleven_english_sts_v2', id: 'eleven_english_sts_v2' },
        { label: 'eleven_multilingual_sts_v2', id: 'eleven_multilingual_sts_v2' },
      ],
      value: () => 'eleven_english_sts_v2',
      condition: { field: 'operation', value: 'speech_to_speech' },
    },

    {
      id: 'stability',
      title: 'Stability',
      type: 'short-input',
      placeholder: '0.0 to 1.0 (e.g., 0.5)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tts' },
    },
    {
      id: 'similarityBoost',
      title: 'Similarity Boost',
      type: 'short-input',
      placeholder: '0.0 to 1.0 (e.g., 0.75)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'tts' },
    },

    {
      id: 'durationSeconds',
      title: 'Duration (seconds)',
      type: 'short-input',
      placeholder: '0.5 to 30 (leave empty to auto-determine)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'sound_effects' },
    },
    {
      id: 'promptInfluence',
      title: 'Prompt Influence',
      type: 'short-input',
      placeholder: '0.0 to 1.0 (e.g., 0.3)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'sound_effects' },
    },
    {
      id: 'loop',
      title: 'Loop',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'sound_effects' },
    },

    {
      id: 'removeBackgroundNoise',
      title: 'Remove Background Noise',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'speech_to_speech' },
    },

    {
      id: 'editStability',
      title: 'Stability',
      type: 'short-input',
      placeholder: '0.0 to 1.0 (e.g., 0.5)',
      condition: { field: 'operation', value: 'edit_voice_settings' },
    },
    {
      id: 'editSimilarityBoost',
      title: 'Similarity Boost',
      type: 'short-input',
      placeholder: '0.0 to 1.0 (e.g., 0.75)',
      condition: { field: 'operation', value: 'edit_voice_settings' },
    },
    {
      id: 'editStyle',
      title: 'Style',
      type: 'short-input',
      placeholder: '0.0 to 1.0 (e.g., 0.0)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'edit_voice_settings' },
    },
    {
      id: 'editSpeed',
      title: 'Speed',
      type: 'short-input',
      placeholder: '1.0 = normal',
      mode: 'advanced',
      condition: { field: 'operation', value: 'edit_voice_settings' },
    },
    {
      id: 'editUseSpeakerBoost',
      title: 'Use Speaker Boost',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'edit_voice_settings' },
    },

    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Filter voices by name, description, labels, or category',
      condition: { field: 'operation', value: 'list_voices' },
    },
    {
      id: 'category',
      title: 'Category',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Premade', id: 'premade' },
        { label: 'Cloned', id: 'cloned' },
        { label: 'Generated', id: 'generated' },
        { label: 'Professional', id: 'professional' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_voices' },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '1 to 100 (default 10)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_voices' },
    },

    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your ElevenLabs API key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: [
      'elevenlabs_tts',
      'elevenlabs_sound_effects',
      'elevenlabs_speech_to_speech',
      'elevenlabs_audio_isolation',
      'elevenlabs_list_voices',
      'elevenlabs_get_voice',
      'elevenlabs_get_voice_settings',
      'elevenlabs_edit_voice_settings',
      'elevenlabs_list_models',
      'elevenlabs_get_user',
    ],
    config: {
      tool: (params) => `elevenlabs_${params.operation || 'tts'}`,
      params: (params) => {
        const audioFile = normalizeFileInput(params.audioFile, { single: true })
        return {
          apiKey: params.apiKey,
          text: params.text,
          voiceId: params.voiceId,
          modelId: params.modelId,
          audioFile,
          search: params.search,
          category: params.category || undefined,
          pageSize: toNumber(params.pageSize),
          stability: toNumber(params.stability ?? params.editStability),
          similarityBoost: toNumber(params.similarityBoost ?? params.editSimilarityBoost),
          style: toNumber(params.editStyle),
          speed: toNumber(params.editSpeed),
          useSpeakerBoost: toBoolean(params.editUseSpeakerBoost),
          durationSeconds: toNumber(params.durationSeconds),
          promptInfluence: toNumber(params.promptInfluence),
          loop: toBoolean(params.loop),
          removeBackgroundNoise: toBoolean(params.removeBackgroundNoise),
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    text: { type: 'string', description: 'Text to convert or sound prompt' },
    voiceId: { type: 'string', description: 'Voice identifier' },
    audioFile: { type: 'json', description: 'Source audio file (UserFile)' },
    modelId: { type: 'string', description: 'Model identifier' },
    stability: { type: 'number', description: 'Voice stability 0.0-1.0' },
    similarityBoost: { type: 'number', description: 'Similarity boost 0.0-1.0' },
    durationSeconds: { type: 'number', description: 'Sound effect length in seconds (0.5-30)' },
    promptInfluence: { type: 'number', description: 'Sound prompt influence 0.0-1.0' },
    loop: { type: 'boolean', description: 'Generate a seamlessly looping sound effect' },
    removeBackgroundNoise: { type: 'boolean', description: 'Isolate the voice during conversion' },
    editStability: { type: 'number', description: 'Voice stability to set 0.0-1.0' },
    editSimilarityBoost: { type: 'number', description: 'Similarity boost to set 0.0-1.0' },
    editStyle: { type: 'number', description: 'Style exaggeration to set 0.0-1.0' },
    editSpeed: { type: 'number', description: 'Speech speed to set (1.0 = normal)' },
    editUseSpeakerBoost: { type: 'boolean', description: 'Enable speaker boost' },
    search: { type: 'string', description: 'Voice search filter' },
    category: { type: 'string', description: 'Voice category filter' },
    pageSize: { type: 'number', description: 'Number of voices to return (1-100)' },
    apiKey: { type: 'string', description: 'ElevenLabs API key' },
  },

  outputs: {
    audioUrl: {
      type: 'string',
      description: 'Generated audio URL',
      condition: {
        field: 'operation',
        value: ['tts', 'sound_effects', 'speech_to_speech', 'audio_isolation'],
      },
    },
    audioFile: {
      type: 'file',
      description: 'Generated audio file',
      condition: {
        field: 'operation',
        value: ['tts', 'sound_effects', 'speech_to_speech', 'audio_isolation'],
      },
    },
    voices: {
      type: 'array',
      description: 'List of voices',
      condition: { field: 'operation', value: 'list_voices' },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of matching voices',
      condition: { field: 'operation', value: 'list_voices' },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more voices are available',
      condition: { field: 'operation', value: 'list_voices' },
    },
    nextPageToken: {
      type: 'string',
      description: 'Token to fetch the next page',
      condition: { field: 'operation', value: 'list_voices' },
    },
    voiceId: {
      type: 'string',
      description: 'Voice identifier',
      condition: { field: 'operation', value: 'get_voice' },
    },
    name: {
      type: 'string',
      description: 'Voice name',
      condition: { field: 'operation', value: 'get_voice' },
    },
    category: {
      type: 'string',
      description: 'Voice category',
      condition: { field: 'operation', value: 'get_voice' },
    },
    description: {
      type: 'string',
      description: 'Voice description',
      condition: { field: 'operation', value: 'get_voice' },
    },
    labels: {
      type: 'json',
      description: 'Voice labels',
      condition: { field: 'operation', value: 'get_voice' },
    },
    previewUrl: {
      type: 'string',
      description: 'Preview audio URL',
      condition: { field: 'operation', value: 'get_voice' },
    },
    settings: {
      type: 'json',
      description: 'Voice settings',
      condition: { field: 'operation', value: 'get_voice' },
    },
    availableForTiers: {
      type: 'array',
      description: 'Subscription tiers the voice is available on',
      condition: { field: 'operation', value: 'get_voice' },
    },
    highQualityBaseModelIds: {
      type: 'array',
      description: 'Model IDs supporting high-quality output for this voice',
      condition: { field: 'operation', value: 'get_voice' },
    },
    isOwner: {
      type: 'boolean',
      description: 'Whether the current user owns this voice',
      condition: { field: 'operation', value: 'get_voice' },
    },
    stability: {
      type: 'number',
      description: 'Voice stability',
      condition: { field: 'operation', value: 'get_voice_settings' },
    },
    similarityBoost: {
      type: 'number',
      description: 'Similarity boost',
      condition: { field: 'operation', value: 'get_voice_settings' },
    },
    style: {
      type: 'number',
      description: 'Style exaggeration',
      condition: { field: 'operation', value: 'get_voice_settings' },
    },
    useSpeakerBoost: {
      type: 'boolean',
      description: 'Whether speaker boost is enabled',
      condition: { field: 'operation', value: 'get_voice_settings' },
    },
    speed: {
      type: 'number',
      description: 'Speech speed',
      condition: { field: 'operation', value: 'get_voice_settings' },
    },
    status: {
      type: 'string',
      description: 'Edit outcome ("ok" on success)',
      condition: { field: 'operation', value: 'edit_voice_settings' },
    },
    models: {
      type: 'array',
      description: 'List of available models',
      condition: { field: 'operation', value: 'list_models' },
    },
    userId: {
      type: 'string',
      description: 'User identifier',
      condition: { field: 'operation', value: 'get_user' },
    },
    isNewUser: {
      type: 'boolean',
      description: 'Whether the user is new',
      condition: { field: 'operation', value: 'get_user' },
    },
    subscription: {
      type: 'json',
      description: 'Subscription and usage details',
      condition: { field: 'operation', value: 'get_user' },
    },
  },
}

export const ElevenLabsBlockMeta = {
  tags: ['text-to-speech'],
  url: 'https://elevenlabs.io',
  templates: [
    {
      icon: ElevenLabsIcon,
      title: 'ElevenLabs blog-to-podcast',
      prompt:
        'Build a workflow that takes a blog post, narrates it with an ElevenLabs voice, saves the audio file, and posts a player-ready link to the marketing Slack channel.',
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ElevenLabsIcon,
      title: 'Customer voice greeting generator',
      prompt:
        'Create a workflow that reads a table of new enterprise customers, generates a personalized ElevenLabs voice greeting with their account manager voice, and emails the audio file to the customer on day one.',
      modules: ['tables', 'agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ElevenLabsIcon,
      title: 'ElevenLabs IVR builder',
      prompt:
        'Build a workflow that generates branded ElevenLabs voice prompts from a tables-driven script, saves each clip as a file, and lists the bundle so it can be wired into the phone tree.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
    },
    {
      icon: ElevenLabsIcon,
      title: 'ElevenLabs + Pulse meeting voice digest',
      prompt:
        'Build a workflow that takes Pulse meeting insights, narrates them with an ElevenLabs voice, and emails the audio digest to the team for asynchronous review.',
      modules: ['agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['pulse', 'gmail'],
    },
    {
      icon: ElevenLabsIcon,
      title: 'ElevenLabs daily voice digest',
      prompt:
        'Build a scheduled daily workflow that generates an ElevenLabs voice digest of the day’s key metrics, saves the audio, and Slacks the player link to leadership.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['founder', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ElevenLabsIcon,
      title: 'ElevenLabs release-notes narrator',
      prompt:
        "Create a workflow that takes new product release notes, rewrites them into a natural spoken script with an agent, generates narration with ElevenLabs text-to-speech, and saves the audio file ready to share as a what's-new update.",
      modules: ['agent', 'files', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
    },
    {
      icon: ElevenLabsIcon,
      title: 'ElevenLabs voicemail responder',
      prompt:
        'Build a workflow that on a new inbound message drafts a short personalized reply with an agent, converts it to speech with ElevenLabs in a chosen voice, and saves the audio so it can be sent as a voice note to the customer.',
      modules: ['agent', 'files', 'workflows'],
      category: 'support',
      tags: ['support', 'communication', 'automation'],
    },
  ],
  skills: [
    {
      name: 'narrate-text-to-speech',
      description:
        'Convert a block of text into natural-sounding speech audio with a chosen ElevenLabs voice.',
      content:
        '# Narrate Text to Speech\n\nGenerate spoken audio from text using ElevenLabs.\n\n## Steps\n1. Take the text to narrate and confirm the target voice ID (ask for one if not provided).\n2. Pick a model — use a multilingual model for non-English or mixed-language text, or a turbo/flash model when low latency matters.\n3. For consistent delivery, set stability higher; for more expressive variation, set it lower. Raise similarity boost to stay closer to the reference voice.\n\n## Output\nReturn the generated audio file and its URL. Confirm the voice and model used so the requester can adjust if the delivery is not right.',
    },
    {
      name: 'narrate-article-as-audio',
      description: 'Turn a long article or blog post into a podcast-style audio narration.',
      content:
        '# Narrate Article as Audio\n\nProduce a listenable audio version of written content.\n\n## Steps\n1. Clean the source text — strip markdown, navigation, and boilerplate so only the readable prose remains. Expand abbreviations the voice should speak in full.\n2. Choose a voice ID suited to the content and a high-quality multilingual model for natural delivery.\n3. Convert the cleaned text to speech, keeping stability moderate so the narration sounds engaging but consistent.\n\n## Output\nReturn the audio file and a player-ready URL, along with the voice used. If the text is very long, note any truncation and suggest splitting it into parts.',
    },
    {
      name: 'generate-voice-prompt',
      description:
        'Generate a short branded voice clip such as an IVR prompt, greeting, or notification.',
      content:
        '# Generate Voice Prompt\n\nCreate a short, polished voice clip for things like phone menus, greetings, or alerts.\n\n## Steps\n1. Take the exact script for the prompt. Keep it concise and confirm pronunciation of any names or numbers.\n2. Select a consistent brand voice ID so every prompt sounds the same.\n3. Set stability high for a steady, professional delivery and convert the script to speech.\n\n## Output\nReturn the audio file and its URL. When generating a set of prompts, list each clip with its script so they can be wired into the phone tree or app.',
    },
  ],
} as const satisfies BlockMeta
