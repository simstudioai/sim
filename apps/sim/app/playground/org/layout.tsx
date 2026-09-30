import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { env, isTruthy } from '@/lib/core/config/env'
import { isMothershipModelSelectorEnabled, isPlanModeEnabled } from '@/lib/mothership/feature-flags'
import { ProtoShell } from '@/app/playground/org/components/proto-shell'
import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'

/** Org-level project view over real workspace data. Gated like the EMCN playground. */
export default async function OrgPrototypeLayout({ children }: { children: ReactNode }) {
  if (!isTruthy(env.NEXT_PUBLIC_ENABLE_PLAYGROUND)) notFound()
  const [modelSelectorEnabled, planModeEnabled] = await Promise.all([
    isMothershipModelSelectorEnabled(),
    isPlanModeEnabled(),
  ])
  return (
    <FeatureFlagsProvider
      flags={{
        dashboards: true,
        'table-row-ttl': false,
        'mothership-model-selector': modelSelectorEnabled,
        'mothership-plan-mode': planModeEnabled,
      }}
    >
      <ProtoShell>{children}</ProtoShell>
    </FeatureFlagsProvider>
  )
}
