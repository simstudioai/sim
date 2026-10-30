import type { ReactNode } from 'react'
import NextImage from 'next/image'
import { cn } from '@/components/docs/classnames'

export type ScreenshotVariant = 'hero' | 'overview' | 'detail' | 'result'

interface ScreenshotFrameProps {
  children: ReactNode
  variant: ScreenshotVariant | 'viewer'
  backgroundSrc: string
  sizes: string
  eager?: boolean
}

/** Shared photographic framing for authored screenshots and the full-size viewer. */
export function ScreenshotFrame({
  children,
  variant,
  backgroundSrc,
  sizes,
  eager = false,
}: ScreenshotFrameProps) {
  return (
    <span
      className={cn(
        'relative block overflow-hidden rounded-lg border border-[var(--docs-border)] bg-[var(--docs-surface)]',
        variant === 'hero' && 'aspect-[50/19] max-sm:aspect-[2/1]',
        variant === 'overview' && 'px-[7%] pt-[6%]',
        variant === 'detail' && 'p-[5%]',
        variant === 'result' && 'px-[5%] pt-[5%]',
        variant === 'viewer' && 'min-h-0 flex-1 p-4 sm:p-8'
      )}
    >
      <NextImage
        src={backgroundSrc}
        alt=''
        aria-hidden
        fill
        sizes={sizes}
        loading={eager ? 'eager' : 'lazy'}
        className='pointer-events-none object-cover object-[center_32%]'
      />
      <span
        className={cn(
          variant === 'viewer'
            ? 'relative flex size-full items-center justify-center [&>img]:rounded-lg [&>img]:border [&>img]:border-[var(--docs-border)] [&>img]:shadow-[var(--docs-shadow)] dark:[&>img]:border-0'
            : 'block overflow-hidden border border-[var(--docs-border)] bg-[var(--docs-canvas)] shadow-[var(--docs-shadow)] dark:border-0',
          variant === 'hero' &&
            'absolute top-[18.4%] left-[11%] w-[78%] rounded-t-lg max-sm:top-[14%] max-sm:left-[6%] max-sm:w-[88%]',
          variant === 'detail' && 'relative rounded-md',
          (variant === 'overview' || variant === 'result') && 'relative rounded-t-lg border-b-0'
        )}
      >
        {children}
      </span>
    </span>
  )
}
