'use client'

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

export interface PlanFeature {
  icon: LucideIcon
  text: string
}

export interface PlanCardProps {
  name: string
  price: string | ReactNode
  priceSubtext?: string
  features: PlanFeature[]
  buttonText: string
  onButtonClick: () => void
  isError?: boolean
  variant?: 'default' | 'compact'
  layout?: 'vertical' | 'horizontal'
  className?: string
}

/**
 * PlanCard component for displaying subscription plan information
 * Supports both vertical and horizontal layouts with flexible pricing display
 */
export function PlanCard({
  name,
  price,
  priceSubtext,
  features,
  buttonText,
  onButtonClick,
  isError = false,
  variant = 'default',
  layout = 'vertical',
  className,
}: PlanCardProps) {
  const isHorizontal = layout === 'horizontal'

  const renderPrice = () => {
    if (typeof price === 'string') {
      return (
        <>
          <span className='font-semibold text-[20px]'>{price}</span>
          {priceSubtext && (
            <span className='ml-1 text-[12px] text-[var(--text-muted)]'>{priceSubtext}</span>
          )}
        </>
      )
    }
    return price
  }

  const renderFeatures = () => {
    if (isHorizontal) {
      return (
        <div className='mt-3 flex flex-wrap items-center gap-3'>
          {features.map((feature, index) => (
            <div key={`${feature.text}-${index}`} className='flex items-center gap-2 text-[12px]'>
              <feature.icon className='h-3 w-3 flex-shrink-0 text-[var(--text-secondary)]' />
              <span className='text-[var(--text-secondary)]'>{feature.text}</span>
              {index < features.length - 1 && (
                <div className='ml-3 h-4 w-px bg-[var(--border)]' aria-hidden='true' />
              )}
            </div>
          ))}
        </div>
      )
    }

    return (
      <ul className='mb-4 flex-1 space-y-2'>
        {features.map((feature, index) => (
          <li key={`${feature.text}-${index}`} className='flex items-start gap-2 text-[12px]'>
            <feature.icon
              className='mt-0.5 h-3 w-3 flex-shrink-0 text-[var(--text-secondary)]'
              aria-hidden='true'
            />
            <span className='text-[var(--text-secondary)]'>{feature.text}</span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <article
      className={cn(
        'relative flex rounded-[8px] border p-4 transition-colors hover:border-[var(--border-hover)]',
        isHorizontal ? 'flex-row items-center justify-between gap-6' : 'flex-col',
        className
      )}
    >
      <header className={isHorizontal ? 'flex-1' : 'mb-4'}>
        <h3 className='mb-2 font-semibold text-[14px]'>{name}</h3>
        <div className='flex items-baseline'>{renderPrice()}</div>
        {isHorizontal && renderFeatures()}
      </header>

      {!isHorizontal && renderFeatures()}

      <div className={isHorizontal ? 'flex-shrink-0' : undefined}>
        <Button
          onClick={onButtonClick}
          className={cn(
            'h-9 rounded-[8px] text-[13px]',
            isHorizontal ? 'min-w-[100px] px-6' : 'w-full',
            isError && 'border-[var(--text-error)] text-[var(--text-error)]'
          )}
          variant='outline'
          aria-label={`${buttonText} ${name} plan`}
        >
          {isError ? 'Error' : buttonText}
        </Button>
      </div>
    </article>
  )
}
