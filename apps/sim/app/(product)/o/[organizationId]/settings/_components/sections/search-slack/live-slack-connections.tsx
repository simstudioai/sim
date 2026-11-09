'use client'

import { SlackConnections } from '@/app/(product)/o/[organizationId]/settings/_components/sections/search-slack/slack-connections'
import { SlackSetupDialog } from '@/app/(product)/o/[organizationId]/settings/_components/sections/search-slack/slack-setup-dialog'
import { useLiveSlackSearch, useLiveSlackSetup } from '@/platform/lib/data/slack-search'
import type { SetupTarget } from '@/platform/lib/data/slack-search-model'

interface LiveSlackSetupProps {
  organizationId: string
  target: SetupTarget
  botName?: string
  close: () => void
}

function LiveSlackSetup({ organizationId, target, botName, close }: LiveSlackSetupProps) {
  const flow = useLiveSlackSetup(organizationId, target, botName, close)
  return <SlackSetupDialog target={target} flow={flow} />
}

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
