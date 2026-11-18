/**
 * Encodes a meeting ID or UUID for a Zoom API path segment. Zoom requires a UUID that starts with
 * `/` or contains `//` to be double encoded; `/past_meetings/{meetingId}` requires it for a UUID
 * containing any `/` (`anySlash`).
 */
export function encodeZoomMeetingPathId(meetingId: string, { anySlash = false } = {}): string {
  const encoded = encodeURIComponent(meetingId)
  const doubleEncode = anySlash
    ? meetingId.includes('/')
    : meetingId.startsWith('/') || meetingId.includes('//')
  return doubleEncode ? encodeURIComponent(encoded) : encoded
}
