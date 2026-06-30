'use client'

import { useRouter } from 'next/navigation'
import { LandingPromptStorage } from '@/lib/core/utils/browser-storage'
import { cn } from '@/lib/core/utils/cn'
import { trackLandingCta } from '@/app/(landing)/landing-analytics'

interface TemplateCardButtonProps {
  /**
   * Curated template prompt, already rewritten to `@`-mention form by the
   * page's server-side `mentionifyPromptForNames` (registry-free, so the
   * landing client bundle never pulls the full block registry). Stored verbatim
   * for the home input to consume after signup.
   */
  prompt: string
  className?: string
  children: React.ReactNode
}

export function TemplateCardButton({ prompt, className, children }: TemplateCardButtonProps) {
  const router = useRouter()

  function savePromptAndNavigate() {
    LandingPromptStorage.store(prompt)
    trackLandingCta({ label: 'Template card', section: 'integrations', destination: '/signup' })
    router.push('/signup')
  }

  return (
    <button
      type='button'
      onClick={savePromptAndNavigate}
      className={cn('w-full text-left', className)}
    >
      {children}
    </button>
  )
}
