import type {
  GoogleMeetApiSpaceResponse,
  GoogleMeetSpaceConfigDetails,
} from '@/tools/google_meet/types'
import type { ToolOutputProperty } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Build a Meet resource name (`spaces/{id}` or `conferenceRecords/{id}`) from either the full
 * name or the bare ID, rejecting values that would escape the collection path.
 */
export function buildMeetResourceName(
  value: string | number,
  collection: 'spaces' | 'conferenceRecords',
  paramName: string
): string {
  const prefix = `${collection}/`
  if (typeof value !== 'string') return `${prefix}${safeUrlPathSegment(value, paramName)}`
  const trimmed = value.trim()
  const id = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed
  return `${prefix}${safeUrlPathSegment(id, paramName)}`
}

/** Space config fields beyond access type and entry point access. */
export function buildSpaceConfigDetails(
  space: GoogleMeetApiSpaceResponse
): GoogleMeetSpaceConfigDetails {
  return {
    moderation: space.config?.moderation ?? null,
    attendanceReportGenerationType: space.config?.attendanceReportGenerationType ?? null,
    artifactConfig: space.config?.artifactConfig ?? null,
  }
}

export const SPACE_CONFIG_DETAIL_OUTPUTS: Record<
  keyof GoogleMeetSpaceConfigDetails,
  ToolOutputProperty
> = {
  moderation: { type: 'string', description: 'Host moderation: ON or OFF', optional: true },
  attendanceReportGenerationType: {
    type: 'string',
    description: 'Attendance report: GENERATE_REPORT or DO_NOT_GENERATE',
    optional: true,
  },
  artifactConfig: {
    type: 'json',
    description:
      'Auto-generated artifacts: recordingConfig.autoRecordingGeneration, transcriptionConfig.autoTranscriptionGeneration, smartNotesConfig.autoSmartNotesGeneration (ON or OFF)',
    optional: true,
  },
}
