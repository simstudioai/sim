'use client'

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/emcn'

interface ErrorAction {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  variant?: 'default' | 'ghost'
}

export interface ErrorStateProps {
  error: Error & { digest?: string }
  reset: () => void
  title: string
  description: string
  loggerName: string
  secondaryAction?: ErrorAction
}

export function ErrorState({
  error,
  reset,
  title,
  description,
  loggerName,
  secondaryAction,
}: ErrorStateProps) {
  const logger = createLogger(loggerName)

  useEffect(() => {
    logger.error(`${loggerName} error:`, { error: error.message, digest: error.digest })
  }, [error, logger, loggerName])

  return (
    <div className='flex h-full flex-1 items-center justify-center'>
      <div className='flex flex-col items-center gap-[16px] text-center'>
        <div className='flex flex-col gap-[8px]'>
          <h2 className='font-semibold text-[16px] text-[var(--text-primary)]'>{title}</h2>
          <p className='max-w-[300px] text-[13px] text-[var(--text-tertiary)]'>{description}</p>
        </div>
        <div className='flex items-center gap-[8px]'>
          {secondaryAction && (
            <Button
              variant={secondaryAction.variant ?? 'ghost'}
              size='sm'
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.icon}
              {secondaryAction.label}
            </Button>
          )}
          <Button variant='default' size='sm' onClick={reset}>
            <RefreshCw className='mr-[6px] h-[14px] w-[14px]' />
            Try again
          </Button>
        </div>
      </div>
    </div>
  )
}
