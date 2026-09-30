'use client'

import { useRouter } from 'next/navigation'
import { MockComposer } from '@/app/playground/org/components/mock-composer'
import { PEOPLE } from '@/app/playground/org/lib/mock-data'
import { protoRoutes } from '@/app/playground/org/lib/routes'

/** New chat: just ask. Projects are where resources live, not where chats do. */
export function NewChatHome() {
  const router = useRouter()
  const firstName = PEOPLE.teddy.name.split(' ')[0]

  return (
    <div className='flex h-full flex-col items-center justify-center px-6 pt-[2vh] pb-[18vh]'>
      <h1 className='mb-8 max-w-chat text-balance text-center font-season text-[26px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em] sm:text-[28px]'>
        What should we get done, {firstName}?
      </h1>
      <MockComposer
        placeholder='Do anything'
        className='w-full max-w-chat'
        onSubmit={() => router.push(protoRoutes.chat('new'))}
      />
    </div>
  )
}
