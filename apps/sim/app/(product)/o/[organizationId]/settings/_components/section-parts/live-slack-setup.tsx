'use client'

import { SlackSetupDialog } from '@/app/(product)/o/[organizationId]/settings/_components/section-parts/slack-setup-dialog'
import { useLiveSlackSetup } from '@/platform/lib/data/slack-search'
import type { SetupTarget } from '@/platform/lib/data/slack-search-model'

interface LiveSlackSetupProps {
  organizationId: string
  target: SetupTarget
  botName?: string
  close: () => void
}

/**
 * The Sim Search setup dialog on live data, which Slack Settings and Credential Groups' Slack member
 * setup open for the organization's app.
 */
export function LiveSlackSetup({ organizationId, target, botName, close }: LiveSlackSetupProps) {
  const flow = useLiveSlackSetup(organizationId, target, botName, close)
  return <SlackSetupDialog target={target} flow={flow} />
}
