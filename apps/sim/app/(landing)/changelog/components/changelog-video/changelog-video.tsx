import { cn, Lightbox } from '@sim/emcn'
import { isChangelogMediaSource } from '@/lib/changelog/media'
import { LANDING_STAGE_RADIUS } from '@/app/(landing)/components/landing-layout'

interface ChangelogVideoProps {
  src: string
  poster: string
  /** Accessible description for the player; not repeated below the video. */
  caption: string
  captionsSrc?: string
  width?: number | `${number}`
  height?: number | `${number}`
}

/** A quiet poster opens the recording in the shared media viewer. */
export function ChangelogVideo({
  src,
  poster,
  caption,
  captionsSrc,
  width = 1280,
  height = 720,
}: ChangelogVideoProps) {
  if (!isChangelogMediaSource(src) || (captionsSrc && !isChangelogMediaSource(captionsSrc))) {
    throw new Error('Changelog recordings must use same-origin paths or the approved media CDN')
  }
  return (
    <figure className='my-6'>
      <Lightbox type='video' src={src} poster={poster} alt={caption} captionsSrc={captionsSrc}>
        <button
          type='button'
          aria-label={`Open ${caption} in media viewer`}
          className={cn(
            'block w-full cursor-zoom-in overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-4',
            LANDING_STAGE_RADIUS
          )}
        >
          <video
            muted
            playsInline
            preload='none'
            poster={poster}
            width={width}
            height={height}
            aria-hidden='true'
            tabIndex={-1}
            className='pointer-events-none block h-auto w-full bg-[var(--surface-2)]'
          >
            <source src={src} type='video/mp4' />
            {captionsSrc ? (
              <track kind='captions' src={captionsSrc} srcLang='en' label='English' />
            ) : null}
          </video>
        </button>
      </Lightbox>
    </figure>
  )
}
