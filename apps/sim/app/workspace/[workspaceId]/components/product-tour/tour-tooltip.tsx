'use client'

import type { TooltipRenderProps } from 'react-joyride'
import { cn } from '@/lib/core/utils/cn'

export function TourTooltip({
  continuous,
  index,
  step,
  backProps,
  closeProps,
  primaryProps,
  skipProps,
  isLastStep,
  tooltipProps,
}: TooltipRenderProps) {
  return (
    <div
      {...tooltipProps}
      className={cn(
        'w-[340px] rounded-[10px] border border-[var(--border-1)]',
        'bg-[var(--surface-1)] shadow-[0_8px_30px_rgba(0,0,0,0.3)]'
      )}
    >
      <div className='px-[20px] pt-[20px] pb-[4px]'>
        {step.title && (
          <h3 className='font-[480] font-season text-[16px] text-[var(--text-primary)] leading-[120%] tracking-[-0.02em]'>
            {step.title as string}
          </h3>
        )}
      </div>
      <div className='px-[20px] pt-[8px] pb-[16px]'>
        <p className='text-[13.5px] text-[var(--text-secondary)] leading-[160%]'>{step.content}</p>
      </div>
      <div className='flex items-center justify-between border-[var(--border)] border-t px-[16px] py-[12px]'>
        <div className='flex items-center'>
          {!isLastStep && (
            <button
              {...skipProps}
              type='button'
              className='cursor-pointer text-[12.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]'
            >
              Skip tour
            </button>
          )}
        </div>
        <div className='flex items-center gap-[6px]'>
          {index > 0 && (
            <button
              {...backProps}
              type='button'
              className='h-[30px] cursor-pointer rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-3)] px-[12px] text-[12.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-5)] hover:text-[var(--text-primary)]'
            >
              Back
            </button>
          )}
          {continuous ? (
            <button
              {...primaryProps}
              type='button'
              className='h-[30px] cursor-pointer rounded-[6px] bg-[var(--brand-tertiary-2,#33c482)] px-[12px] font-medium text-[12.5px] text-white transition-colors hover:opacity-90'
            >
              {isLastStep ? 'Done' : 'Next'}
            </button>
          ) : (
            <button
              {...closeProps}
              type='button'
              className='h-[30px] cursor-pointer rounded-[6px] bg-[var(--brand-tertiary-2,#33c482)] px-[12px] font-medium text-[12.5px] text-white transition-colors hover:opacity-90'
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
