'use client'

import { useParams } from 'next/navigation'
import { IntegrationTabsHeader } from '@/app/workspace/[workspaceId]/integrations/components/integration-tabs-header'

/**
 * Route-level fallback for the skills catalog.
 *
 * Mirrors the page's own Suspense fallback so the shared tab header persists
 * across the navigation. `useParams` supplies the workspace id, which
 * `loading.tsx` does not receive as a prop.
 */
export default function SkillsLoading() {
  const { workspaceId } = useParams<{ workspaceId: string }>()

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <IntegrationTabsHeader active='skills' workspaceId={workspaceId} />
    </div>
  )
}
