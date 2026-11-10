import { HuntApiIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalNumberInput } from '@/blocks/utils'

export const HuntApiBlock: BlockConfig = {
  type: 'huntapi',
  name: 'HuntAPI',
  description: 'Download videos and audio from public video URLs',
  authMode: AuthMode.ApiKey,
  longDescription:
    "Start a download of a public video in a chosen quality and format, or extract its audio track, then check the job to get a link to the file with the video's title, duration, channel and view counts.",
  docsLink: 'https://docs.sim.ai/integrations/huntapi',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  bgColor: '#FFFFFF',
  icon: HuntApiIcon,
  canvasPresentation: {
    defaultTitle: 'HuntAPI',
    sentences: {
      byOperation: {
        download_video: [
          { text: 'Download the video', field: 'url', core: true },
          { text: 'in', field: 'videoQuality' },
        ],
        download_audio: [{ text: 'Extract the audio of', field: 'url', core: true }],
        get_job: [{ text: 'Check the download job', field: 'jobId', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Download Video', id: 'download_video' },
        { label: 'Download Audio', id: 'download_audio' },
        { label: 'Get Job', id: 'get_job' },
      ],
      value: () => 'download_video',
    },
    {
      id: 'url',
      title: 'Video URL',
      type: 'short-input',
      placeholder: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      condition: { field: 'operation', value: ['download_video', 'download_audio'] },
      required: { field: 'operation', value: ['download_video', 'download_audio'] },
    },
    {
      id: 'videoQuality',
      title: 'Quality',
      type: 'dropdown',
      options: [
        { label: 'Best', id: 'best' },
        { label: '1080p', id: '1080p' },
        { label: '720p', id: '720p' },
        { label: '480p', id: '480p' },
        { label: '360p', id: '360p' },
      ],
      value: () => 'best',
      condition: { field: 'operation', value: 'download_video' },
    },
    {
      id: 'videoFormat',
      title: 'Format',
      type: 'dropdown',
      options: [
        { label: 'MP4', id: 'mp4' },
        { label: 'WebM', id: 'webm' },
        { label: 'MKV', id: 'mkv' },
      ],
      value: () => 'mp4',
      condition: { field: 'operation', value: 'download_video' },
      mode: 'advanced',
    },
    {
      id: 'downloadType',
      title: 'Content',
      type: 'dropdown',
      options: [
        { label: 'Video with sound', id: 'audio_video' },
        { label: 'Video without sound', id: 'video' },
      ],
      value: () => 'audio_video',
      condition: { field: 'operation', value: 'download_video' },
      mode: 'advanced',
    },
    {
      id: 'maxDuration',
      title: 'Max Duration',
      type: 'short-input',
      placeholder: 'Duration in seconds',
      condition: { field: 'operation', value: ['download_video', 'download_audio'] },
      mode: 'advanced',
    },
    {
      id: 'audioQuality',
      title: 'Quality',
      type: 'dropdown',
      options: [
        { label: 'Best', id: 'best' },
        { label: '320 kbps', id: '320kbps' },
        { label: '256 kbps', id: '256kbps' },
        { label: '128 kbps', id: '128kbps' },
      ],
      value: () => 'best',
      condition: { field: 'operation', value: 'download_audio' },
    },
    {
      id: 'audioFormat',
      title: 'Audio Format',
      type: 'dropdown',
      options: [
        { label: 'MP3', id: 'mp3' },
        { label: 'M4A', id: 'm4a' },
        { label: 'WAV', id: 'wav' },
      ],
      value: () => 'mp3',
      condition: { field: 'operation', value: 'download_audio' },
      mode: 'advanced',
    },
    {
      id: 'jobId',
      title: 'Job ID',
      type: 'short-input',
      placeholder: 'Enter the job ID',
      condition: { field: 'operation', value: 'get_job' },
      required: { field: 'operation', value: 'get_job' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your HuntAPI API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['huntapi_download_video', 'huntapi_download_audio', 'huntapi_get_job'],
    config: {
      tool: (params) => `huntapi_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (['download_video', 'download_audio'].includes(params.operation)) {
          result.maxDuration = parseOptionalNumberInput(params.maxDuration, 'Max Duration', {
            integer: true,
            min: 1,
          })
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    url: {
      type: 'string',
      description: 'URL of the public video (e.g., "https://www.youtube.com/watch?v=jNQXAC9IVRw")',
    },
    videoQuality: {
      type: 'string',
      description:
        'Quality: best, 1080p, 720p, 480p or 360p (defaults to "best"); videos over an hour are capped at 720p',
    },
    videoFormat: {
      type: 'string',
      description: 'Preferred format: mp4, webm or mkv (defaults to "mp4")',
    },
    downloadType: {
      type: 'string',
      description:
        'audio_video for the video with sound, video for the picture only (defaults to "audio_video")',
    },
    maxDuration: {
      type: 'number',
      description: 'Maximum duration in seconds; longer content is cut at this length',
    },
    audioQuality: {
      type: 'string',
      description: 'Quality: best, 320kbps, 256kbps or 128kbps (defaults to "best")',
    },
    audioFormat: {
      type: 'string',
      description: 'Preferred format: mp3, m4a or wav (defaults to "mp3")',
    },
    jobId: {
      type: 'string',
      description: 'The job ID returned by Download Video or Download Audio',
    },
    apiKey: { type: 'string', description: 'HuntAPI API key' },
  },
  outputs: {
    jobId: { type: 'string', description: 'ID of the download job' },
    status: {
      type: 'string',
      description: 'Status of the job, CompletedJob once the file is ready',
    },
    progress: { type: 'number', description: 'Progress of the job, from 0 to 100' },
    fileUrl: { type: 'string', description: 'Link to the downloaded file, once the job completes' },
    createdAt: { type: 'string', description: 'When the job was created' },
    completedAt: { type: 'string', description: 'When the job completed' },
    durationMs: { type: 'number', description: 'Time the job took, in milliseconds' },
    metadata: { type: 'json', description: 'Metadata of the video, once the job completes' },
  },
}

export const HuntApiBlockMeta = {
  tags: ['automation', 'content-management'],
  url: 'https://www.huntapi.com',
  templates: [
    {
      icon: HuntApiIcon,
      title: 'HuntAPI video transcriber',
      prompt:
        'Build a workflow that takes a video URL, extracts its audio with HuntAPI, waits for the job to complete, transcribes the audio, and saves the transcript to a knowledge base.',
      modules: ['knowledge-base', 'workflows'],
      category: 'productivity',
      tags: ['research', 'automation'],
    },
    {
      icon: HuntApiIcon,
      title: 'HuntAPI content archive',
      prompt:
        'Create a scheduled workflow that downloads new videos from a list of channels with HuntAPI and records each file link, title and upload date in a table for archival.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['compliance', 'automation'],
    },
    {
      icon: HuntApiIcon,
      title: 'HuntAPI lecture notes',
      prompt:
        'Build a workflow that extracts the audio of a recorded lecture with HuntAPI, transcribes it, and has an agent write structured study notes to a file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['education', 'automation'],
    },
    {
      icon: HuntApiIcon,
      title: 'HuntAPI competitor ad collector',
      prompt:
        "Create a workflow that downloads competitors' video ads with HuntAPI, stores their view and like counts in a table, and has an agent summarize the messaging of each ad.",
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['research', 'monitoring'],
    },
    {
      icon: HuntApiIcon,
      title: 'HuntAPI brand mention tracker',
      prompt:
        'Build a workflow that downloads videos mentioning our brand with HuntAPI, transcribes them, and posts the mentions with their view counts to Slack.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: HuntApiIcon,
      title: 'HuntAPI training data builder',
      prompt:
        'Create a workflow that extracts the audio of a list of public videos with HuntAPI and writes each file link and duration to a table, to build a speech dataset.',
      modules: ['tables', 'workflows'],
      category: 'engineering',
      tags: ['data', 'automation'],
    },
    {
      icon: HuntApiIcon,
      title: 'HuntAPI video metadata report',
      prompt:
        "Build a workflow that downloads a list of videos with HuntAPI and reports each one's title, uploader, duration, views and likes in a table.",
      modules: ['tables', 'workflows'],
      category: 'marketing',
      tags: ['analysis', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'download-video-file',
      description:
        'Download a public video with HuntAPI and return the link to the file once the job completes.',
      content:
        '# Download Video File\n\nGet a downloadable file for a public video.\n\n## Steps\n1. Run the download video operation with the video URL and the quality you need.\n2. Take the job ID it returns and run the get job operation.\n3. Repeat get job every few seconds until the status is CompletedJob, then read the file link.\n\n## Output\nReturn the file link with the video title and duration.',
    },
    {
      name: 'extract-video-audio',
      description:
        'Extract the audio track of a video with HuntAPI, for transcription or a speech dataset.',
      content:
        '# Extract Video Audio\n\nTurn a video into an audio file, for example before transcribing it.\n\n## Steps\n1. Run the download audio operation with the video URL; use mp3 unless another format is needed.\n2. Run the get job operation with the returned job ID until the status is CompletedJob.\n3. Pass the file link to the transcription step.\n\n## Output\nReturn the audio file link with the video title and duration.',
    },
    {
      name: 'collect-video-metadata',
      description:
        'Collect the title, uploader, duration, views and likes of public videos with HuntAPI.',
      content:
        '# Collect Video Metadata\n\nBuild a table of video statistics.\n\n## Steps\n1. Run the download video operation for each video URL, with a short maximum duration to keep the download small.\n2. Run the get job operation for each job until it completes.\n3. Read the metadata: title, uploader, duration, view, like and comment counts, and upload date.\n\n## Output\nReturn one row per video with its metadata and URL.',
    },
  ],
} as const satisfies BlockMeta
