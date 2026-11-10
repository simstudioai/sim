'use client'

import type { ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { type SessionFrameProps, SessionTree } from '@/app/(product)/_components/product-session'
import { IntegrationCenterChanges } from '@/app/(product)/_components/session/integration-center-changes'
import { IntegrationChanges } from '@/app/(product)/_components/session/integration-changes'
import type { Scenario } from '@/platform/fixtures'
import type { SettingsNavGroup, ShellData } from '@/platform/lib/data/models/shell'
import {
  type PreviewPlan,
  readAppearance,
  readPreviewPlan,
  readScenario,
} from '@/platform/lib/navigation'

function FixtureEdits({ children }: { children: ReactNode }) {
  return (
    <IntegrationChanges>
      <IntegrationCenterChanges>{children}</IntegrationCenterChanges>
    </IntegrationChanges>
  )
}

/**
 * A fixture build's session: the scenario, plan and theme its URL selects. Only this path reads the
 * query, so a live session never re-renders on a query change.
 */
export function FixtureProductSession({
  fixtures,
  routePrefix,
  banner,
  sidebarCollapsed,
  children,
}: SessionFrameProps & {
  fixtures: Record<
    Scenario,
    ShellData & { settingsByPlan: Record<PreviewPlan, SettingsNavGroup[]> }
  >
}) {
  const search = useSearchParams()
  const scenario = readScenario(search.get('state'))
  const fixture = fixtures[scenario]
  return (
    <SessionTree
      routePrefix={routePrefix}
      banner={banner}
      sidebarCollapsed={sidebarCollapsed}
      data={{
        ...fixture,
        settingsNavigation: fixture.settingsByPlan[readPreviewPlan(search.get('plan'))],
      }}
      theme={readAppearance(search.get('theme'))}
      scenario={scenario}
      Edits={FixtureEdits}
    >
      {children}
    </SessionTree>
  )
}
