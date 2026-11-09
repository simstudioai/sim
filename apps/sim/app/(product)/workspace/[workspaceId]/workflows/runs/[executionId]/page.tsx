import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { platformHref } from '@/platform/lib/navigation'
import type { ProductPageProps } from '@/platform/lib/route-props'
import { withRunListView } from '@/platform/lib/workspace-views'
import { readTestReturn } from '@/platform/shared/test-return'

export const metadata: Metadata = { title: 'Run snapshot' }

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

/**
 * A run's frozen workflow. It lives in the Workflows tab, the one place the block registry the
 * canvas draws with may load, and returns to the run it came from, or to the test whose draft run
 * opened it.
 */
export default async function Page({
  params,
  searchParams,
}: ProductPageProps<{ workspaceId: string; executionId: string }>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId, executionId }, query, { RunSnapshot }] = await Promise.all([
    params,
    searchParams,
    import(
      '@/app/(product)/workspace/[workspaceId]/workflows/_components/run-snapshot/run-snapshot'
    ),
  ])
  const search = { get: (key: string) => (typeof query[key] === 'string' ? query[key] : null) }
  const runId = decodeURIComponent(executionId)
  const test = readTestReturn(query)
  return (
    <RunSnapshot
      workspaceId={workspaceId}
      executionId={runId}
      back={
        test
          ? {
              href: platformHref(
                workspacePath(workspaceId, `tests/${encodeURIComponent(test)}`),
                search
              ),
              label: test,
            }
          : {
              href: withRunListView(
                platformHref(
                  workspacePath(workspaceId, `logs/${encodeURIComponent(runId)}`),
                  search
                ),
                query
              ),
              label: `Run ${runId.slice(0, 8)}`,
            }
      }
    />
  )
}
