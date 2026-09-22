'use client'

import { Chip, StatusPageContent } from '@sim/emcn'
import { useRouter } from 'next/navigation'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'

interface ChatErrorStateProps {
  error: string
}

export function ChatErrorState({ error }: ChatErrorStateProps) {
  const router = useRouter()

  return (
    <div className='flex flex-1 items-center justify-center px-4 py-16 text-center'>
      <StatusPageContent title='Chat Unavailable' description={error}>
        <Chip
          variant='primary'
          onClick={() => router.push(APP_ENTRY_PATH)}
          fullWidth
          type='button'
          className='text-center'
        >
          Open Sim
        </Chip>
      </StatusPageContent>
    </div>
  )
}
