import { formatClockTime } from '@/platform/shared/time'

interface MessageTimeProps {
  sentAt: number
  timeZone?: string
}

export function MessageTime({ sentAt, timeZone }: MessageTimeProps) {
  return (
    <time data-type='T052' dateTime={new Date(sentAt).toISOString()}>
      {formatClockTime(sentAt, timeZone)}
    </time>
  )
}
