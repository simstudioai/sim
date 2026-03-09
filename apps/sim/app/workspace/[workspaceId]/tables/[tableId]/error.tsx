'use client'

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'

const logger = createLogger('TableViewerError')

interface TableViewerErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function TableViewerError({ error, reset }: TableViewerErrorProps) {
  const router = useRouter()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  useEffect(() => {
    logger.error('Table viewer error:', { error: error.message, digest: error.digest })
  }, [error])

  return (
    <div className='flex h-full flex-1 flex-col'>
      {/* Header */}
      <div className='flex h-[48px] shrink-0 items-center border-[var(--border)] border-b px-[16px]'>
        <button
          onClick={() => router.push(`/workspace/${workspaceId}/tables`)}
          className='flex items-center gap-[6px] text-[13px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]'
        >
          <ArrowLeft className='h-[14px] w-[14px]' />
          Back to Tables
        </button>
      </div>

      {/* Error Content */}
      <div className='flex flex-1 items-center justify-center'>
        <div className='flex flex-col items-center gap-[16px] text-center'>
          <div className='flex h-[48px] w-[48px] items-center justify-center rounded-full bg-[var(--surface-4)]'>
            <AlertTriangle className='h-[24px] w-[24px] text-[var(--text-error)]' />
          </div>
          <div className='flex flex-col gap-[8px]'>
            <h2 className='font-semibold text-[16px] text-[var(--text-primary)]'>
              Failed to load table
            </h2>
            <p className='max-w-[300px] text-[13px] text-[var(--text-tertiary)]'>
              Something went wrong while loading this table. The table may have been deleted or you
              may not have permission to view it.
            </p>
          </div>
          <div className='flex items-center gap-[8px]'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => router.push(`/workspace/${workspaceId}/tables`)}
            >
              <ArrowLeft className='mr-[6px] h-[14px] w-[14px]' />
              Go back
            </Button>
            <Button variant='default' size='sm' onClick={reset}>
              <RefreshCw className='mr-[6px] h-[14px] w-[14px]' />
              Try again
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
