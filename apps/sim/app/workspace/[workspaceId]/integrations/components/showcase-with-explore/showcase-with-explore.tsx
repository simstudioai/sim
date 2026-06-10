'use client'

import { ArrowRight } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Chip } from '@/components/emcn'
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
  const router = useRouter()
  const workspaceId = (params?.workspaceId as string) || ''

  return (
    <div className='relative'>
      <IntegrationsShowcase />
      <Chip
        rightIcon={ArrowRight}
        onClick={() => {
          LandingPromptStorage.store(prompt)
          router.push(`/workspace/${workspaceId}/home`)
        }}
        className='absolute right-0 bottom-0 mx-0'
      >
        Explore in chat
      </Chip>
    </div>
  )
}
