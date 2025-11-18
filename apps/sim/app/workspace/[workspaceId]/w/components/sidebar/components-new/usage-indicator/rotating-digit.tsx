'use client'

import { cn } from '@/lib/utils'

export interface RotatingDigitProps {
  value: number | string
  height?: number
  width?: number
  className?: string
  textClassName?: string
}

/**
 * RotatingDigit component for displaying numbers with a rolling animation effect.
 * Useful for live-updating metrics like usage, pricing, or counters.
 *
 * @example
 * ```tsx
 * <RotatingDigit value={123.45} height={14} width={8} />
 * ```
 */
export function RotatingDigit({
  value,
  height = 14, // Default to match text size
  width = 8,
  className,
  textClassName,
}: RotatingDigitProps) {
  const parts =
    typeof value === 'number' ? value.toFixed(2).split('') : (value as string).toString().split('')

  return (
    <div className={cn('flex items-center overflow-hidden', className)} style={{ height }}>
      {parts.map((part: string, index: number) => {
        if (/[0-9]/.test(part)) {
          return (
            <SingleDigit
              key={`${index}-${parts.length}`} // Key by index and length to reset if length changes
              digit={Number.parseInt(part, 10)}
              height={height}
              width={width}
              className={textClassName}
            />
          )
        }
        return (
          <div
            key={`${index}-${part}`}
            className={cn('flex items-center justify-center', textClassName)}
            style={{ height, width: width / 2 }}
          >
            {part}
          </div>
        )
      })}
    </div>
  )
}

function SingleDigit({
  digit,
  height,
  width,
  className,
}: {
  digit: number
  height: number
  width: number
  className?: string
}) {
  return (
    <div className='relative overflow-hidden' style={{ height, width }}>
      <div
        className='absolute top-0 left-0 flex flex-col will-change-transform'
        style={{
          transform: `translateY(-${digit * height}px)`,
          transition: 'transform 500ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <div
            key={num}
            className={cn('flex items-center justify-center', className)}
            style={{ height, width }}
          >
            {num}
          </div>
        ))}
      </div>
    </div>
  )
}
