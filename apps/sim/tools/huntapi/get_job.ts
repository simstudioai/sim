import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecord, toRecordOrNull } from '@sim/utils/object'
import type {
  HuntApiGetJobParams,
  HuntApiGetJobResponse,
  HuntApiMediaMetadata,
} from '@/tools/huntapi/types'
import { HUNT_API_MEDIA_METADATA_OUTPUT_PROPERTIES } from '@/tools/huntapi/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/** Reads a `HuntApiMediaMetadata` from an untyped HuntAPI API payload. */
function mapHuntApiMediaMetadata(value: unknown): HuntApiMediaMetadata | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    title: toStringOrNull(record.title),
    description: toStringOrNull(record.description),
    duration: toNumberOrNull(record.duration),
    extension: toStringOrNull(record.ext),
    thumbnail: toStringOrNull(record.thumbnail),
    uploader: toStringOrNull(record.uploader),
    uploaderUrl: toStringOrNull(record.uploader_url),
    viewCount: toNumberOrNull(record.view_count),
    likeCount: toNumberOrNull(record.like_count),
    commentCount: toNumberOrNull(record.comment_count),
    uploadDate: toNumberOrNull(record.upload_date),
    webpageUrl: toStringOrNull(record.original_url),
  }
}

export const huntapiGetJobTool: ToolConfig<HuntApiGetJobParams, HuntApiGetJobResponse> = {
  id: 'huntapi_get_job',
  name: 'HuntAPI Get Job',
  description:
    "Get a download job's status and progress and, once it completes, the link to the file with the video's metadata.",
  version: '1.0.0',

  params: {
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The job ID returned by Download Video or Download Audio',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'HuntAPI API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://api.huntapi.com/v1/jobs/${safeUrlPathSegment(params.jobId, 'jobId')}`
      )
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        jobId: toStringOrNull(data.id),
        status: toStringOrNull(data.status),
        progress: toNumberOrNull(data.progress),
        fileUrl: toStringOrNull(toRecord(data.result).response),
        createdAt: toStringOrNull(data.created_at),
        completedAt: toStringOrNull(data.completed_at),
        durationMs: toNumberOrNull(data.duration_ms),
        metadata: mapHuntApiMediaMetadata(toRecord(data.result).metadata),
      },
    }
  },

  outputs: {
    jobId: {
      type: 'string',
      description: 'ID of the download job',
      optional: true,
    },
    status: {
      type: 'string',
      description: 'Status of the job, CompletedJob once the file is ready',
      optional: true,
    },
    progress: {
      type: 'number',
      description: 'Progress of the job, from 0 to 100',
      optional: true,
    },
    fileUrl: {
      type: 'string',
      description: 'Link to the downloaded file, once the job completes',
      optional: true,
    },
    createdAt: {
      type: 'string',
      description: 'When the job was created',
      optional: true,
    },
    completedAt: {
      type: 'string',
      description: 'When the job completed',
      optional: true,
    },
    durationMs: {
      type: 'number',
      description: 'Time the job took, in milliseconds',
      optional: true,
    },
    metadata: {
      type: 'object',
      description: 'Metadata of the video, once the job completes',
      optional: true,
      properties: HUNT_API_MEDIA_METADATA_OUTPUT_PROPERTIES,
    },
  },
}
