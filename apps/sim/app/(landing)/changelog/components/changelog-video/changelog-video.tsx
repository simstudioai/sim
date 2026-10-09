import { cn } from '@sim/emcn'
import { isChangelogMediaSource } from '@/lib/changelog/media'
import { LANDING_STAGE_RADIUS } from '@/app/(landing)/components/landing-layout'

interface ChangelogVideoProps {
  src: string
  poster: string
  /** Accessible description for the player; not repeated below the video. */
  caption: string
  captionsSrc?: string
}

/** Product recordings load on demand and retain a readable description without playback. */
export function ChangelogVideo({ src, poster, caption, captionsSrc }: ChangelogVideoProps) {
  if (!isChangelogMediaSource(src) || (captionsSrc && !isChangelogMediaSource(captionsSrc))) {
    throw new Error('Changelog recordings must use same-origin paths or the approved media CDN')
  }
  return (
    <figure className='my-6'>
      <video
        controls
        muted={!captionsSrc}
        playsInline
        crossOrigin='anonymous'
        preload='none'
        poster={poster}
        aria-label={caption}
        className={cn('aspect-video w-full bg-[var(--surface-2)]', LANDING_STAGE_RADIUS)}
      >
        <source src={src} type='video/mp4' />
        {captionsSrc ? (
          <track kind='captions' src={captionsSrc} srcLang='en' label='English' default />
        ) : null}
        <a href={src}>Watch the demo</a>
      </video>
    </figure>
  )
}
