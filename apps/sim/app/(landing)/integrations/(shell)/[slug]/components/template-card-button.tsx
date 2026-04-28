'use client'

import { useRouter } from 'next/navigation'
import { LandingPromptStorage } from '@/lib/core/utils/browser-storage'
import { cn } from '@/lib/core/utils/cn'
import { trackLandingCta } from '@/app/(landing)/landing-analytics'

interface TemplateCardButtonProps {
  prompt: string
  className?: string
  children: React.ReactNode
}

export function TemplateCardButton({ prompt, className, children }: TemplateCardButtonProps) {
  const router = useRouter()

  function handleClick() {
    LandingPromptStorage.store(prompt)
    trackLandingCta({ label: 'Template card', section: 'integrations', destination: '/signup' })
    router.push('/signup')
  }

  return (
    <button type='button' onClick={handleClick} className={cn('w-full text-left', className)}>
      {children}
    </button>
  )
}
