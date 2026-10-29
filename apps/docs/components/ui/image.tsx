import { omit } from '@sim/utils/object'
import NextImage, { type ImageProps as NextImageProps } from 'next/image'
import { cn } from '@/components/docs/classnames'
import { MediaViewer } from '@/components/ui/media-viewer'
import screenshotAssets from '@/lib/screenshot-assets.json'

interface ImageProps extends Omit<NextImageProps, 'className'> {
  className?: string
  enableLightbox?: boolean
  variant?: 'overview' | 'detail' | 'result'
  background?: 'san-francisco' | 'architecture' | 'ridges' | 'canyon'
  caption?: string
}

export function Image({
  className,
  enableLightbox = true,
  variant = 'detail',
  caption,
  alt = '',
  src,
  ...props
}: ImageProps) {
  const original = typeof src === 'string' ? src : 'default' in src ? src.default.src : src.src
  const optimizedAssets: Record<string, string> = screenshotAssets
  const imageSrc = optimizedAssets[original] ?? src
  const image = (
    <span
      className={cn(
        'relative block overflow-hidden rounded-2xl bg-[var(--docs-surface)] p-5',
        variant === 'detail' && 'p-4'
      )}
    >
      <NextImage
        {...omit(props, ['background'])}
        src={imageSrc}
        alt={alt}
        sizes='(max-width: 767px) calc(100vw - 40px), (max-width: 1023px) calc(100vw - 88px), 680px'
        className='relative block h-auto w-full rounded-lg border border-[var(--docs-border)]'
      />
    </span>
  )
  return (
    <figure className={cn('not-prose my-7 min-w-0', className)}>
      {enableLightbox ? (
        <MediaViewer src={original} alt={alt} caption={caption}>
          {image}
        </MediaViewer>
      ) : (
        image
      )}
      {caption && (
        <figcaption className='mt-3 text-[var(--docs-muted)] text-docs-caption'>
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
