'use client'

import { ArrowRight } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { LandingPromptStorage } from '@/lib/core/utils/browser-storage'
import { IntegrationsShowcase } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'

interface ShowcaseWithExploreProps {
  /** Prompt stored for the home page chat to consume after navigation. */
  prompt: string
}

/**
 * Renders the integrations showcase with an "Explore in chat" CTA pinned into
 * the showcase's bottom-right mask notch. Clicking the CTA seeds the home page
 * chat with `prompt` and navigates to the workspace home.
 */
export function ShowcaseWithExplore({ prompt }: ShowcaseWithExploreProps) {
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''
  const router = useRouter()

  return (
    <div className='relative'>
      <IntegrationsShowcase />
      <button
        type='button'
        onClick={() => {
          LandingPromptStorage.store(prompt)
          router.push(`/workspace/${workspaceId}/home`)
        }}
        className='group absolute right-0 bottom-0 inline-flex h-[30px] items-center gap-1.5 rounded-lg bg-[var(--surface-active)] px-2 transition-colors hover-hover:bg-[var(--surface-6)]'
      >
        <span className='text-[var(--text-body)] text-sm'>Explore in chat</span>
        <ArrowRight className='h-4 w-4 flex-shrink-0 text-[var(--text-icon)]' />
      </button>
    </div>
  )
}
