'use client'

import { LiveSlackSetup } from '@/app/(product)/o/[organizationId]/settings/_components/section-parts/live-slack-setup'
import { SlackConnections } from '@/app/(product)/o/[organizationId]/settings/_components/sections/search-slack/slack-connections'
import { useLiveSlackSearch } from '@/platform/lib/data/slack-search'

/** The Connection section on live data, through the Slack Search queries and mutations. */
export function LiveSlackConnections({ organizationId }: { organizationId: string }) {
  const connections = useLiveSlackSearch(organizationId)
  return (
    <SlackConnections
      connections={connections}
      renderSetup={(target, botName, close) => (
        <LiveSlackSetup
          key={target.previous?.id ?? 'new'}
          organizationId={organizationId}
          target={target}
          botName={botName}
          close={close}
        />
      )}
    />
  )
}
