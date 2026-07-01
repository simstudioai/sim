'use client'

import { useRouter } from 'next/navigation'

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
        <button
          onClick={() => router.push('/workspace')}
          className='inline-flex h-[32px] w-full items-center justify-center gap-2 rounded-[5px] border border-[var(--text-primary)] bg-[var(--text-primary)] px-2.5 text-[var(--bg)] text-sm transition-colors hover:border-[var(--text-body)] hover:bg-[var(--text-body)] disabled:cursor-not-allowed disabled:opacity-50'
        >
          Return to Workspace
        </button>
      </div>
    </div>
  )
}
