'use client'

import type { ComponentType, ReactNode, SVGProps } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

export interface PlanFeature {
  icon: LucideIcon | ComponentType<SVGProps<SVGSVGElement>>
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
  className?: string
  /** Renders the card in horizontal layout with features in a row */
  horizontal?: boolean
  /** Places the button inline to the right of features instead of below */
  inlineButton?: boolean
}

/**
 * Displays subscription plan information with features and action button.
 */
export function PlanCard({
  name,
  price,
  priceSubtext,
  features,
  buttonText,
  onButtonClick,
  isError = false,
  className,
  horizontal = false,
  inlineButton = false,
}: PlanCardProps) {
  const renderPrice = () => {
    if (typeof price === 'string') {
      return (
        <>
          <span className='font-medium text-[14px] text-[var(--text-primary)]'>{price}</span>
          {priceSubtext && (
            <span className='ml-[4px] text-[12px] text-[var(--text-secondary)]'>
              {priceSubtext}
            </span>
          )}
        </>
      )
    }
    return price
  }

  if (horizontal) {
    return (
      <article
        className={cn(
          'flex flex-col overflow-hidden rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)]',
          className
        )}
      >
        <div className='flex items-center justify-between gap-[8px] px-[14px] py-[10px]'>
          <div className='flex items-baseline gap-[8px]'>
            <span className='font-medium text-[14px] text-[var(--text-primary)]'>{name}</span>
            <div className='flex items-baseline'>{renderPrice()}</div>
          </div>
          <Button
            onClick={onButtonClick}
            variant={isError ? 'outline' : 'tertiary'}
            aria-label={`${buttonText} ${name} plan`}
          >
            {isError ? 'Error' : buttonText}
          </Button>
        </div>
        <ul className='flex flex-wrap items-center gap-x-[16px] gap-y-[8px] rounded-t-[8px] border-[var(--border-1)] border-t bg-[var(--surface-4)] px-[14px] py-[16px]'>
          {features.map((feature, index) => {
            const Icon = feature.icon
            return (
              <li key={`${feature.text}-${index}`} className='flex items-center gap-[8px]'>
                <Icon className='h-[12px] w-[12px] flex-shrink-0 text-[var(--text-primary)]' />
                <span className='text-[12px] text-[var(--text-primary)]'>{feature.text}</span>
              </li>
            )
          })}
        </ul>
      </article>
    )
  }

  return (
    <article
      className={cn(
        'flex flex-1 flex-col overflow-hidden rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)]',
        className
      )}
    >
      <div className='flex items-center justify-between gap-[8px] px-[14px] py-[10px]'>
        <span className='font-medium text-[14px] text-[var(--text-primary)]'>{name}</span>
        <div className='flex items-baseline'>{renderPrice()}</div>
      </div>
      <div
        className={cn(
          'flex rounded-t-[8px] border-[var(--border-1)] border-t bg-[var(--surface-4)] px-[14px]',
          inlineButton
            ? 'items-center justify-between gap-[16px] py-[12px]'
            : 'flex-1 flex-col gap-[16px] py-[16px]'
        )}
      >
        <ul
          className={cn(
            'flex gap-[14px]',
            inlineButton
              ? 'flex-row flex-wrap items-center gap-x-[16px] gap-y-[8px]'
              : 'flex-1 flex-col'
          )}
        >
          {features.map((feature, index) => {
            const Icon = feature.icon
            return (
              <li key={`${feature.text}-${index}`} className='flex items-center gap-[8px]'>
                <Icon className='h-[12px] w-[12px] flex-shrink-0 text-[var(--text-primary)]' />
                <span className='text-[12px] text-[var(--text-primary)]'>{feature.text}</span>
              </li>
            )
          })}
        </ul>
        <Button
          onClick={onButtonClick}
          className={cn(!inlineButton && 'w-full')}
          variant={isError ? 'outline' : 'tertiary'}
          aria-label={`${buttonText} ${name} plan`}
        >
          {isError ? 'Error' : buttonText}
        </Button>
      </div>
    </article>
  )
}
