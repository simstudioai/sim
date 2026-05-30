import { FFmpegIcon } from '@/components/icons'
import { type BlockConfig, IntegrationType } from '@/blocks/types'
import { normalizeFileInput, parseOptionalNumberInput } from '@/blocks/utils'
import type { FfmpegFileResponse } from '@/tools/ffmpeg/types'

const SINGLE_FILE_OPS = [
  'convert',
  'extract_audio',
  'trim',
  'compress',
  'probe',
  'thumbnail',
  'volume',
  'speed',
]
const ACCEPTED_MEDIA_TYPES = '.mp4,.mov,.avi,.mkv,.webm,.mp3,.m4a,.wav,.ogg,.flac,.aac,.opus'

export const FfmpegBlock: BlockConfig<FfmpegFileResponse> = {
  type: 'ffmpeg',
  name: 'FFmpeg',
  description: 'Process video and audio files with FFmpeg',
  longDescription:
    'Transcode, trim, compress, concatenate, and inspect video and audio files server-side with FFmpeg. Convert formats, extract audio, capture thumbnails, adjust volume, and change playback speed — no external service required.',
  docsLink: 'https://docs.sim.ai/tools/ffmpeg',
  category: 'tools',
  integrationType: IntegrationType.DeveloperTools,
  tags: ['media-processing', 'document-processing'],
  bgColor: '#FFFFFF',
  icon: FFmpegIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Convert Format', id: 'convert' },
        { label: 'Extract Audio', id: 'extract_audio' },
        { label: 'Trim / Cut', id: 'trim' },
        { label: 'Compress / Scale', id: 'compress' },
        { label: 'Get Media Info', id: 'probe' },
        { label: 'Extract Thumbnail', id: 'thumbnail' },
        { label: 'Concatenate', id: 'concat' },
        { label: 'Adjust Volume', id: 'volume' },
        { label: 'Change Speed', id: 'speed' },
      ],
      value: () => 'convert',
      required: true,
    },

    // Single-file input (basic)
    {
      id: 'inputFile',
      title: 'Media File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload a video or audio file',
      mode: 'basic',
      multiple: false,
      acceptedTypes: ACCEPTED_MEDIA_TYPES,
      condition: { field: 'operation', value: 'concat', not: true },
      required: { field: 'operation', value: 'concat', not: true },
    },
    // Single-file input (advanced)
    {
      id: 'inputFileRef',
      title: 'Media File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference a media file from a previous block',
      mode: 'advanced',
      condition: { field: 'operation', value: 'concat', not: true },
      required: { field: 'operation', value: 'concat', not: true },
    },

    // Multi-file input for concat (basic)
    {
      id: 'inputFiles',
      title: 'Media Files',
      type: 'file-upload',
      canonicalParamId: 'files',
      placeholder: 'Upload two or more files to join',
      mode: 'basic',
      multiple: true,
      acceptedTypes: ACCEPTED_MEDIA_TYPES,
      condition: { field: 'operation', value: 'concat' },
      required: { field: 'operation', value: 'concat' },
    },
    // Multi-file input for concat (advanced)
    {
      id: 'inputFilesRef',
      title: 'Media Files',
      type: 'short-input',
      canonicalParamId: 'files',
      placeholder: 'Reference media files from a previous block',
      mode: 'advanced',
      condition: { field: 'operation', value: 'concat' },
      required: { field: 'operation', value: 'concat' },
    },

    // Output format
    {
      id: 'format',
      title: 'Output Format',
      type: 'short-input',
      placeholder: 'convert: mp4, webm, mp3 · audio: mp3, wav · thumbnail: jpg, png',
      condition: { field: 'operation', value: ['convert', 'extract_audio', 'thumbnail'] },
      required: { field: 'operation', value: 'convert' },
    },

    // Trim fields
    {
      id: 'startTime',
      title: 'Start Time',
      type: 'short-input',
      placeholder: 'e.g. 5 or 00:00:05',
      condition: { field: 'operation', value: 'trim' },
    },
    {
      id: 'duration',
      title: 'Duration',
      type: 'short-input',
      placeholder: 'e.g. 30 or 00:00:30',
      condition: { field: 'operation', value: 'trim' },
    },

    // Compress fields
    {
      id: 'scale',
      title: 'Scale',
      type: 'short-input',
      placeholder: 'e.g. 1280x720 or 1280:-2 (keep aspect ratio)',
      condition: { field: 'operation', value: 'compress' },
    },
    {
      id: 'crf',
      title: 'Quality (CRF)',
      type: 'slider',
      min: 0,
      max: 51,
      step: 1,
      integer: true,
      defaultValue: 23,
      condition: { field: 'operation', value: 'compress' },
    },
    {
      id: 'videoBitrate',
      title: 'Video Bitrate',
      type: 'short-input',
      placeholder: 'e.g. 1M or 800k',
      mode: 'advanced',
      condition: { field: 'operation', value: 'compress' },
    },

    // Thumbnail timestamp
    {
      id: 'time',
      title: 'Timestamp',
      type: 'short-input',
      placeholder: 'e.g. 5 or 00:00:05',
      condition: { field: 'operation', value: 'thumbnail' },
    },

    // Volume
    {
      id: 'volume',
      title: 'Volume',
      type: 'short-input',
      placeholder: 'Multiplier (1.5, 0.5) or decibels (10dB, -6dB)',
      condition: { field: 'operation', value: 'volume' },
      required: { field: 'operation', value: 'volume' },
    },

    // Speed
    {
      id: 'speed',
      title: 'Speed',
      type: 'short-input',
      placeholder: 'Multiplier, e.g. 2 (faster) or 0.5 (slower)',
      condition: { field: 'operation', value: 'speed' },
      required: { field: 'operation', value: 'speed' },
    },

    // Codec overrides (advanced)
    {
      id: 'videoCodec',
      title: 'Video Codec',
      type: 'short-input',
      placeholder: 'e.g. libx264, vp9',
      mode: 'advanced',
      condition: { field: 'operation', value: ['convert', 'compress'] },
    },
    {
      id: 'audioCodec',
      title: 'Audio Codec',
      type: 'short-input',
      placeholder: 'e.g. aac, libmp3lame',
      mode: 'advanced',
      condition: { field: 'operation', value: ['convert', 'extract_audio'] },
    },
  ],

  tools: {
    access: [
      'ffmpeg_convert',
      'ffmpeg_extract_audio',
      'ffmpeg_trim',
      'ffmpeg_compress',
      'ffmpeg_probe',
      'ffmpeg_thumbnail',
      'ffmpeg_concat',
      'ffmpeg_volume',
      'ffmpeg_speed',
    ],
    config: {
      tool: (params) => `ffmpeg_${params.operation}`,
      params: (params) => {
        const file =
          params.operation && SINGLE_FILE_OPS.includes(params.operation)
            ? normalizeFileInput(params.file, { single: true })
            : undefined
        const files = params.operation === 'concat' ? normalizeFileInput(params.files) : undefined

        return {
          file,
          files,
          format: params.format,
          videoCodec: params.videoCodec,
          audioCodec: params.audioCodec,
          startTime: params.startTime,
          duration: params.duration,
          scale: params.scale,
          crf: parseOptionalNumberInput(params.crf, 'Quality (CRF)', {
            integer: true,
            min: 0,
            max: 51,
          }),
          videoBitrate: params.videoBitrate,
          time: params.time,
          volume: params.volume,
          speed: parseOptionalNumberInput(params.speed, 'Speed', { min: 0.1, max: 100 }),
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'FFmpeg operation to perform' },
    file: { type: 'json', description: 'Input media file (UserFile)' },
    files: { type: 'json', description: 'Input media files for concatenation (UserFile[])' },
    format: { type: 'string', description: 'Output format/container' },
    videoCodec: { type: 'string', description: 'Video codec override' },
    audioCodec: { type: 'string', description: 'Audio codec override' },
    startTime: { type: 'string', description: 'Trim start offset' },
    duration: { type: 'string', description: 'Trim duration' },
    scale: { type: 'string', description: 'Output scale dimensions' },
    crf: { type: 'number', description: 'Constant Rate Factor (compress quality)' },
    videoBitrate: { type: 'string', description: 'Target video bitrate' },
    time: { type: 'string', description: 'Thumbnail timestamp' },
    volume: { type: 'string', description: 'Volume adjustment' },
    speed: { type: 'number', description: 'Playback speed multiplier' },
  },

  outputs: {
    file: {
      type: 'file',
      description: 'Processed media file',
      condition: { field: 'operation', value: 'probe', not: true },
    },
    fileName: {
      type: 'string',
      description: 'Generated output file name',
      condition: { field: 'operation', value: 'probe', not: true },
    },
    format: { type: 'string', description: 'Output or detected container format' },
    size: {
      type: 'number',
      description: 'Output file size in bytes',
      condition: { field: 'operation', value: 'probe', not: true },
    },
    durationSeconds: {
      type: 'number',
      description: 'Media duration in seconds',
      condition: { field: 'operation', value: 'probe' },
    },
    bitrate: {
      type: 'number',
      description: 'Overall bitrate in bits per second',
      condition: { field: 'operation', value: 'probe' },
    },
    width: {
      type: 'number',
      description: 'Video width in pixels',
      condition: { field: 'operation', value: 'probe' },
    },
    height: {
      type: 'number',
      description: 'Video height in pixels',
      condition: { field: 'operation', value: 'probe' },
    },
    hasVideo: {
      type: 'boolean',
      description: 'Whether a video stream is present',
      condition: { field: 'operation', value: 'probe' },
    },
    hasAudio: {
      type: 'boolean',
      description: 'Whether an audio stream is present',
      condition: { field: 'operation', value: 'probe' },
    },
    videoCodec: {
      type: 'string',
      description: 'Primary video codec',
      condition: { field: 'operation', value: 'probe' },
    },
    audioCodec: {
      type: 'string',
      description: 'Primary audio codec',
      condition: { field: 'operation', value: 'probe' },
    },
    streams: {
      type: 'array',
      description: 'All detected media streams',
      condition: { field: 'operation', value: 'probe' },
    },
  },
}
