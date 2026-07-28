'use client'

import { useParams } from 'next/navigation'
import { IntegrationTabsHeader } from '@/app/workspace/[workspaceId]/integrations/components/integration-tabs-header'

/**
 * Route-level fallback for the integrations catalog.
 *
 * Renders the same chrome the page uses as its Suspense fallback, so the tab
 * header stays put across the navigation instead of the previous route holding
 * until the server responds. `useParams` supplies the workspace id, which
 * `loading.tsx` does not receive as a prop.
 */
export default function IntegrationsLoading() {
  const { workspaceId } = useParams<{ workspaceId: string }>()

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <IntegrationTabsHeader active='integrations' workspaceId={workspaceId} />
    </div>
  )
}
