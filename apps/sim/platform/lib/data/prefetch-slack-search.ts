import 'server-only'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { listSlackSearchContract } from '@/lib/api/contracts/knowledge/slack'
import { presentSlackSearchList } from '@/lib/api/server/slack-search-presenters'
import { listSlackSearchInstallations } from '@/lib/knowledge/application/slack-search/installations'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import { slackSearchKeys } from '@/hooks/queries/utils/slack-search-keys'
import {
  asRouteResponse,
  requireSessionViewer,
  withinPrefetchBudget,
} from '@/platform/lib/data/server-read'

/** The organization's Slack Search installations, under the list query's own key. */
export async function prefetchSlackSearch(organizationId: string): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  await queryClient.prefetchQuery({
    queryKey: slackSearchKeys.list(organizationId),
    queryFn: () =>
      withinPrefetchBudget(async () => {
        const { principal } = await requireSessionViewer()
        return asRouteResponse(
          listSlackSearchContract,
          presentSlackSearchList(
            await listSlackSearchInstallations.execute({ principal, input: { organizationId } })
          )
        )
      }),
  })
  return dehydrate(queryClient)
}
