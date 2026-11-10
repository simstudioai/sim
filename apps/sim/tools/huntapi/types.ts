import type { OutputProperty, ToolResponse } from '@/tools/types'

/** MediaMetadata read from a HuntAPI API response. */
export interface HuntApiMediaMetadata {
  title: string | null
  description: string | null
  duration: number | null
  extension: string | null
  thumbnail: string | null
  uploader: string | null
  uploaderUrl: string | null
  viewCount: number | null
  likeCount: number | null
  commentCount: number | null
  uploadDate: number | null
  webpageUrl: string | null
}

export const HUNT_API_MEDIA_METADATA_OUTPUT_PROPERTIES = {
  title: {
    type: 'string',
    description: 'Title of the video',
    optional: true,
  },
  description: {
    type: 'string',
    description: 'Description of the video',
    optional: true,
  },
  duration: {
    type: 'number',
    description: 'Duration of the video in seconds',
    optional: true,
  },
  extension: {
    type: 'string',
    description: 'File extension of the download',
    optional: true,
  },
  thumbnail: {
    type: 'string',
    description: 'URL of the video thumbnail',
    optional: true,
  },
  uploader: {
    type: 'string',
    description: 'Name of the uploader',
    optional: true,
  },
  uploaderUrl: {
    type: 'string',
    description: "URL of the uploader's page",
    optional: true,
  },
  viewCount: {
    type: 'number',
    description: 'Number of views',
    optional: true,
  },
  likeCount: {
    type: 'number',
    description: 'Number of likes',
    optional: true,
  },
  commentCount: {
    type: 'number',
    description: 'Number of comments',
    optional: true,
  },
  uploadDate: {
    type: 'number',
    description: 'Upload date as a Unix timestamp in seconds',
    optional: true,
  },
  webpageUrl: {
    type: 'string',
    description: 'URL of the video page',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface HuntApiDownloadVideoParams {
  apiKey: string
  url: string
  videoQuality?: string
  videoFormat?: string
  downloadType?: string
  maxDuration?: number
}

export interface HuntApiDownloadVideoResponse extends ToolResponse {
  output: {
    jobId: string | null
  }
}

export interface HuntApiDownloadAudioParams {
  apiKey: string
  url: string
  audioQuality?: string
  audioFormat?: string
  maxDuration?: number
}

export interface HuntApiDownloadAudioResponse extends ToolResponse {
  output: {
    jobId: string | null
  }
}

export interface HuntApiGetJobParams {
  apiKey: string
  jobId: string
}

export interface HuntApiGetJobResponse extends ToolResponse {
  output: {
    jobId: string | null
    status: string | null
    progress: number | null
    fileUrl: string | null
    createdAt: string | null
    completedAt: string | null
    durationMs: number | null
    metadata: HuntApiMediaMetadata | null
  }
}
