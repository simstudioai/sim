import NextImage, { type ImageProps as NextImageProps } from 'next/image'
import { cn } from '@/components/docs/classnames'
import { MediaViewer } from '@/components/ui/media-viewer'
import { ScreenshotFrame, type ScreenshotVariant } from '@/components/ui/screenshot-frame'
import screenshotAssets from '@/lib/screenshot-assets.json'

interface ImageProps extends Omit<NextImageProps, 'className'> {
  className?: string
  enableLightbox?: boolean
  variant?: ScreenshotVariant
  background?: 'san-francisco' | 'architecture' | 'ridges' | 'canyon'
  caption?: string
}

export function Image({
  className,
  enableLightbox = true,
  variant = 'detail',
  background = variant === 'overview' || variant === 'hero' ? 'san-francisco' : 'architecture',
  caption,
  alt = '',
  src,
  ...props
}: ImageProps) {
  const original = typeof src === 'string' ? src : 'default' in src ? src.default.src : src.src
  const optimizedAssets: Record<string, string> = screenshotAssets
  const imageSrc = optimizedAssets[original] ?? src
  const backgroundSrc = `/static/introduction/${background}.webp`
  const sizes =
    '(max-width: 1023px) calc(100vw - 40px), (max-width: 1279px) calc(100vw - 296px), 728px'
  const image = (
    <ScreenshotFrame
      variant={variant}
      backgroundSrc={backgroundSrc}
      sizes={sizes}
      eager={props.preload}
    >
      <NextImage
        {...props}
        src={imageSrc}
        alt={alt}
        sizes={sizes}
        className='block h-auto w-full'
      />
    </ScreenshotFrame>
  )
  return (
    <figure className={cn('not-prose my-7 min-w-0', className)}>
      {enableLightbox ? (
        <MediaViewer
          expandedImage={
            <NextImage
              src={src}
              alt={alt}
              width={props.width}
              height={props.height}
              unoptimized
              loading='eager'
              className='block h-auto max-h-full w-auto max-w-full object-contain'
            />
          }
          backgroundSrc={backgroundSrc}
          alt={alt}
          caption={caption}
        >
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
