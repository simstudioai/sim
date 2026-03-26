'use client'

import { useRouter } from 'next/navigation'
import { LandingPromptStorage } from '@/lib/core/utils/browser-storage'

interface TemplateCardButtonProps {
  prompt: string
  children: React.ReactNode
}

export function TemplateCardButton({ prompt, children }: TemplateCardButtonProps) {
  const router = useRouter()

  function handleClick() {
    LandingPromptStorage.store(prompt)
    router.push('/signup')
  }

  return (
    <button
      type='button'
      onClick={handleClick}
      className='group flex w-full flex-col items-start rounded-lg border border-[var(--landing-border)] bg-[var(--landing-bg-card)] p-5 text-left transition-colors hover:border-[var(--landing-border-strong)] hover:bg-[var(--landing-bg-elevated)]'
    >
      {children}
    </button>
  )
}
