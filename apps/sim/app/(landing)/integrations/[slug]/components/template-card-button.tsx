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
      className='group flex w-full flex-col items-start rounded-lg border border-[#2A2A2A] bg-[#242424] p-5 text-left transition-colors hover:border-[#3d3d3d] hover:bg-[#2A2A2A]'
    >
      {children}
    </button>
  )
}
