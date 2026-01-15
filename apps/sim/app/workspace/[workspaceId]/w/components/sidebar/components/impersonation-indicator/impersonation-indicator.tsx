'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { Loader2, UserCircle, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'
import { client } from '@/lib/auth/auth-client'

const logger = createLogger('ImpersonationIndicator')

interface ImpersonationIndicatorProps {
  userName: string
}

/**
 * Indicator shown in the sidebar when an admin is impersonating another user.
 * Styled similarly to UsageIndicator for visual consistency.
 */
export function ImpersonationIndicator({ userName }: ImpersonationIndicatorProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const handleStopImpersonating = async () => {
    setIsLoading(true)
    try {
      await client.admin.stopImpersonating()
      router.push('/workspace')
      router.refresh()
    } catch (error) {
      logger.error('Failed to stop impersonating', { error })
      setIsLoading(false)
    }
  }

  return (
    <div className='flex flex-shrink-0 flex-col gap-[6px] border-amber-500/30 border-t bg-amber-500/10 px-[13.5px] pt-[8px] pb-[10px]'>
      <div className='flex items-center justify-between gap-[8px]'>
        <div className='flex min-w-0 flex-1 items-center gap-[6px]'>
          <UserCircle className='h-[14px] w-[14px] flex-shrink-0 text-amber-500' />
          <span className='truncate font-medium text-[12px] text-amber-500'>
            Impersonating {userName}
          </span>
        </div>
        <Button
          variant='ghost'
          className='h-[20px] w-[20px] flex-shrink-0 p-0 text-amber-500 hover:bg-amber-500/20 hover:text-amber-400'
          onClick={handleStopImpersonating}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className='h-[12px] w-[12px] animate-spin' />
          ) : (
            <X className='h-[12px] w-[12px]' />
          )}
        </Button>
      </div>
    </div>
  )
}
