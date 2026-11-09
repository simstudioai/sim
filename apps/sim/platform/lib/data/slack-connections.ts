import 'server-only'
import { listSlackSearchContract, type SlackSearchList } from '@/lib/api/contracts/knowledge/slack'
import { presentSlackSearchList } from '@/lib/api/server/slack-search-presenters'
import { listSlackSearchInstallations } from '@/lib/knowledge/application/slack-search/installations'
import { asRouteResponse, requireSessionViewer } from '@/platform/lib/data/server-read'

/** The organization's Slack Search installations, as the settings route lists them. */
export async function readSlackConnections(organizationId: string): Promise<SlackSearchList> {
  const { principal } = await requireSessionViewer()
  return asRouteResponse(
    listSlackSearchContract,
    presentSlackSearchList(
      await listSlackSearchInstallations.execute({ principal, input: { organizationId } })
    )
  )
}
