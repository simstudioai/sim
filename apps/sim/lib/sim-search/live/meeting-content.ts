import { truncateAtCodePoint } from '@sim/utils/string'

/** Coverage notices precede the text so the first paginated read cannot hide a provider cap. */
export function boundedMeetingContent(content: string, limit = 200_000): string {
  if (content.length <= limit) return content
  const notice = '[Meeting content truncated. Open the original meeting for the remainder.]\n\n'
  return notice + truncateAtCodePoint(content, limit - notice.length, '')
}
