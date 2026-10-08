import { cn } from '@sim/emcn'
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
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes='(max-width: 767px) calc(100vw - 40px), 872px'
        className={cn('h-auto w-full border border-[var(--border)]', LANDING_STAGE_RADIUS)}
      />
      <figcaption className='mt-3 text-[var(--text-secondary)] text-small'>
        {caption ? <p>{caption}</p> : null}
        <a
          href={src}
          target='_blank'
          rel='noopener noreferrer'
          className='mt-2 inline-block underline underline-offset-4'
        >
          View full-size image
        </a>
      </figcaption>
    </figure>
  )
}
