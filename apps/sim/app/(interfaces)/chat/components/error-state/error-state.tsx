'use client'

import { Chip } from '@sim/emcn'
import { useRouter } from 'next/navigation'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'

interface ChatErrorStateProps {
  error: string
}

export function ChatErrorState({ error }: ChatErrorStateProps) {
  const router = useRouter()

  return (
    <div className='flex flex-1 items-center justify-center px-4 py-16 text-center'>
      <div className='flex w-full max-w-[410px] flex-col items-center gap-3'>
        <h1 className='text-balance text-[40px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'>
          Chat Unavailable
        </h1>
        <p className='text-[var(--text-muted)] text-lg'>{error}</p>
        <Chip
          variant='primary'
          onClick={() => router.push(APP_ENTRY_PATH)}
          fullWidth
          type='button'
          className='text-center'
        >
          Open Sim
        </Chip>
      </div>
    </div>
  )
}
