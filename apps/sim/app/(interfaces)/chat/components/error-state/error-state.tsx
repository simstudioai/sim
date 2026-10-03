'use client'

import { Button, StatusPageContent } from '@sim/emcn'
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
        <Button
          type='button'
          variant='primary'
          className='h-[32px] w-full gap-2 px-2.5 text-sm'
          onClick={() => router.push(APP_ENTRY_PATH)}
        >
          Open Sim
        </Button>
      </StatusPageContent>
    </div>
  )
}
