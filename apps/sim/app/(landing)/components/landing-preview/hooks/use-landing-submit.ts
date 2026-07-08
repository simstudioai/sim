'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { LandingPromptStorage } from '@/lib/core/utils/browser-storage'
import { trackLandingCta } from '@/app/(landing)/track-landing-cta'

/**
 * Stores the typed prompt in browser storage and routes to `/signup`, so a
 * visitor's first message survives the auth hop. Shared by the landing
 * preview's chat pane and the home empty-state input.
 */
export function useLandingSubmit() {
  const router = useRouter()
  return useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      LandingPromptStorage.store(trimmed)
      trackLandingCta({
        label: 'Prompt submit',
        section: 'landing_preview',
        destination: '/signup',
      })
      router.push('/signup')
    },
    [router]
  )
}
