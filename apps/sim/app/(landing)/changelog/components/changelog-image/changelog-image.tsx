import { cn, Lightbox } from '@sim/emcn'
import Image from 'next/image'
import { LANDING_STAGE_RADIUS } from '@/app/(landing)/components/landing-layout'

interface ChangelogImageProps {
  src: string
  alt: string
  width: number | `${number}`
  height: number | `${number}`
  caption?: string
}

/** Product screenshots reserve their intrinsic size and use the site's image optimization. */
export function ChangelogImage({ src, alt, width, height, caption }: ChangelogImageProps) {
  return (
    <figure className='my-6'>
      <Lightbox src={src} alt={alt}>
        <button
          type='button'
          aria-label={`Open ${alt} in media viewer`}
          className={cn(
            'block w-full cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-4',
            LANDING_STAGE_RADIUS
          )}
        >
          <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            sizes='(max-width: 767px) calc(100vw - 40px), 872px'
            className={cn('h-auto w-full', LANDING_STAGE_RADIUS)}
          />
        </button>
      </Lightbox>
      {caption ? (
        <figcaption className='mt-3 text-[var(--text-secondary)] text-small'>{caption}</figcaption>
      ) : null}
    </figure>
  )
}
