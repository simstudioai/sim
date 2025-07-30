import { getVideoUrl } from '@/lib/utils'

interface VideoProps {
  src: string
  className?: string
  autoPlay?: boolean
  loop?: boolean
  muted?: boolean
  playsInline?: boolean
}

export function Video({
  src,
  className = 'w-full -mb-2 rounded-lg',
  autoPlay = true,
  loop = true,
  muted = true,
  playsInline = true,
}: VideoProps) {
  return (
    <video
      autoPlay={autoPlay}
      loop={loop}
      muted={muted}
      playsInline={playsInline}
      className={className}
      src={getVideoUrl(src)}
    />
  )
}
