import NextImage, { type ImageProps as NextImageProps } from 'next/image'
import { cn } from '@/components/docs/classnames'
import { MediaViewer } from '@/components/ui/media-viewer'
import { ScreenshotFrame, type ScreenshotVariant } from '@/components/ui/screenshot-frame'
import architecture from '@/public/static/introduction/architecture.webp'
import canyon from '@/public/static/introduction/canyon.webp'
import ridges from '@/public/static/introduction/ridges.webp'
import sanFrancisco from '@/public/static/introduction/san-francisco.webp'

const BACKGROUNDS = { architecture, canyon, ridges, 'san-francisco': sanFrancisco } as const
const MAX_WIDTHS = {
  md: { className: 'max-w-md', rem: 28 },
  xl: { className: 'max-w-xl', rem: 36 },
} as const

function screenshotSizes(scale: number, maxWidth?: keyof typeof MAX_WIDTHS, hero = false) {
  const limit = (value: string, ratio: number) =>
    maxWidth ? `min(${value}, ${MAX_WIDTHS[maxWidth].rem * ratio}rem)` : value
  return [
    ...(hero ? [`(max-width: 639px) ${limit('calc(88vw - 2.2rem)', 0.88)}`] : []),
    `(max-width: 1023px) ${limit(`calc(${scale * 100}vw - ${scale * 2.5}rem)`, scale)}`,
    `(max-width: 1279px) ${limit(`calc(${scale * 100}vw - ${scale * 216}px - ${scale * 5}rem)`, scale)}`,
    limit(`calc(${scale * 856}px - ${scale * 8}rem)`, scale),
  ].join(', ')
}

interface ImageProps extends Omit<NextImageProps, 'className'> {
  className?: string
  enableLightbox?: boolean
  variant?: ScreenshotVariant
  background?: 'san-francisco' | 'architecture' | 'ridges' | 'canyon'
  caption?: string
  maxWidth?: keyof typeof MAX_WIDTHS
}

export function Image({
  className,
  enableLightbox = true,
  variant = 'detail',
  background = variant === 'overview' || variant === 'hero' ? 'san-francisco' : 'architecture',
  caption,
  alt = '',
  src,
  maxWidth,
  sizes: providedSizes,
  ...props
}: ImageProps) {
  const backgroundSrc = BACKGROUNDS[background].src
  const frameSizes = screenshotSizes(1, maxWidth)
  const scale = variant === 'hero' ? 0.78 : variant === 'overview' ? 0.86 : 0.9
  const sizes = providedSizes ?? screenshotSizes(scale, maxWidth, variant === 'hero')
  const image = (
    <ScreenshotFrame
      variant={variant}
      backgroundSrc={backgroundSrc}
      sizes={frameSizes}
      eager={props.preload}
    >
      <NextImage
        {...props}
        src={src}
        quality={90}
        unoptimized={typeof src === 'string' && !src.startsWith('/')}
        alt={alt}
        sizes={sizes}
        className='block h-auto w-full'
      />
    </ScreenshotFrame>
  )
  return (
    <figure
      className={cn(
        'not-prose my-7 min-w-0',
        maxWidth && MAX_WIDTHS[maxWidth].className,
        className
      )}
    >
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
