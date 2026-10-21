import { cn, Lightbox } from '@sim/emcn'
import NextImage, { type ImageProps as NextImageProps } from 'next/image'
import screenshotAssets from '@/lib/screenshot-assets.json'

interface ImageProps extends Omit<NextImageProps, 'className'> {
  className?: string
  enableLightbox?: boolean
  variant?: 'overview' | 'detail' | 'result'
  background?: 'san-francisco' | 'architecture' | 'ridges' | 'canyon'
  caption?: string
}

export function Image({
  className = 'w-full',
  enableLightbox = true,
  variant = 'detail',
  background = variant === 'overview' ? 'san-francisco' : 'architecture',
  caption,
  alt = '',
  src,
  ...props
}: ImageProps) {
  const lightboxSrc = typeof src === 'string' ? src : 'default' in src ? src.default.src : src.src
  const optimizedAssets: Record<string, string> = screenshotAssets
  const imageSrc = optimizedAssets[lightboxSrc] ?? src
  const image = (
    <span
      className={cn(
        'relative block overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]',
        variant === 'overview' && 'px-[7%] pt-[6%]',
        variant === 'detail' && 'p-[5%]',
        variant === 'result' && 'px-[5%] pt-[5%]'
      )}
    >
      <NextImage
        src={`/static/introduction/${background}.webp`}
        alt=''
        aria-hidden
        fill
        sizes='(max-width: 768px) 100vw, 800px'
        className='pointer-events-none object-cover object-[center_32%]'
      />
      <NextImage
        {...props}
        className={cn(
          'relative block h-auto w-full border border-[var(--border)] shadow-[var(--shadow-overlay)]',
          variant === 'detail' ? 'rounded-md' : 'rounded-t-lg border-b-0'
        )}
        alt={alt}
        src={imageSrc}
      />
    </span>
  )

  return (
    <figure className={cn('not-prose my-6', className)}>
      {enableLightbox ? (
        <Lightbox
          src={lightboxSrc}
          alt={alt}
          backgroundSrc={`/static/introduction/${background}.webp`}
        >
          <button
            type='button'
            aria-label={`Open ${alt || 'image'} in media viewer`}
            className='block w-full cursor-zoom-in rounded-lg text-left focus-visible:outline-2 focus-visible:outline-[var(--text-primary)] focus-visible:outline-offset-4'
          >
            {image}
          </button>
        </Lightbox>
      ) : (
        image
      )}
      {caption && (
        <figcaption className='mt-3 text-pretty text-[var(--text-muted)] text-sm leading-relaxed'>
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
