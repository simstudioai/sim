'use client'

import { useRouter } from 'next/navigation'
import { StatusPageLayout } from '@/app/(auth)/components/status-page-layout'

interface FormErrorStateProps {
  error: string
}

export function FormErrorState({ error }: FormErrorStateProps) {
  const router = useRouter()

  return (
    <StatusPageLayout title='Form Unavailable' description={error}>
      <button
        onClick={() => router.push('/workspace')}
        className='inline-flex h-[32px] w-full items-center justify-center gap-2 rounded-[5px] border border-white bg-white px-2.5 font-[430] font-season text-black text-sm transition-colors hover:border-[var(--border-1)] hover:bg-[var(--border-1)] disabled:cursor-not-allowed disabled:opacity-50'
      >
        Return to Workspace
      </button>
    </StatusPageLayout>
  )
}
