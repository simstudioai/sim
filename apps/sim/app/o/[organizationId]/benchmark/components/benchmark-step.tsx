import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import { Loader } from '@sim/emcn/icons'

interface BenchmarkStepProps {
  number: number
  title: string
  description: string
  pending?: boolean
  action?: ReactNode
  children?: ReactNode
}

export function BenchmarkStep({
  number,
  title,
  description,
  pending = false,
  action,
  children,
}: BenchmarkStepProps) {
  return (
    <section aria-labelledby={`benchmark-step-${number}`} className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-start gap-3'>
        <span
          className={cn(
            'flex size-[26px] shrink-0 items-center justify-center rounded-full bg-[var(--surface-3)] text-[var(--text-body)] text-small',
            pending && 'text-[var(--text-muted)]'
          )}
        >
          {pending ? (
            <>
              <Loader animate className='size-[14px]' />
              <span role='status' className='sr-only'>
                Running {title}
              </span>
            </>
          ) : (
            number
          )}
        </span>
        <div className='min-w-0 flex-1'>
          <h2 id={`benchmark-step-${number}`} className='text-[var(--text-primary)] text-base'>
            {title}
          </h2>
          <p className='mt-1 text-[var(--text-muted)] text-small'>{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
