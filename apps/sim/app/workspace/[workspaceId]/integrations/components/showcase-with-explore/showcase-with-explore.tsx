'use client'

import { Chip } from '@sim/emcn'
import { ArrowRight } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { IntegrationsShowcase } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { storeCuratedPrompt } from '@/blocks/integration-matcher'

interface ShowcaseWithExploreProps {
  /**
   * Prompt stored for the home page chat to consume after navigation. Bare
   * integration names are rewritten to `@`-mention form on store so they chip
   * in the chat input (mention treatment is opt-in there).
   */
  prompt: string
}

/**
 * Renders the integrations showcase with an "Explore in chat" CTA pinned into
 * the showcase's bottom-right mask notch. Clicking the CTA seeds the home page
 * chat with `prompt` (via {@link storeCuratedPrompt} so integration names chip)
 * and navigates to the workspace home.
 */
export function ShowcaseWithExplore({ prompt }: ShowcaseWithExploreProps) {
  const params = useParams()
  const router = useRouter()
  const workspaceId = (params?.workspaceId as string) || ''

  return (
    <div className='relative'>
      <IntegrationsShowcase />
      <Chip
        active
        rightIcon={ArrowRight}
        onClick={() => {
          storeCuratedPrompt(prompt)
          router.push(`/workspace/${workspaceId}/home`)
        }}
        className='absolute right-0 bottom-0 mx-0'
      >
        Explore in chat
      </Chip>
    </div>
  )
}
