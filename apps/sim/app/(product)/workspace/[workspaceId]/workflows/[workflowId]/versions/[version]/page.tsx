import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { platformHref } from '@/platform/lib/navigation'
import type { ProductPageProps } from '@/platform/lib/route-props'
import { readTestReturn } from '@/platform/shared/test-return'

export const metadata: Metadata = { title: 'Workflow version' }

/**
 * A deployed version's frozen workflow. It lives in the Workflows tab, the one place the block
 * registry the canvas draws with may load, and returns to the test that ran against it, or else to
 * the workflow.
 */
export default async function Page({
  params,
  searchParams,
}: ProductPageProps<{ workspaceId: string; workflowId: string; version: string }>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId, workflowId, version }, query, { VersionSnapshot }] = await Promise.all([
    params,
    searchParams,
    import(
      '@/app/(product)/workspace/[workspaceId]/workflows/_components/run-snapshot/version-snapshot'
    ),
  ])
  if (!/^[1-9]\d*$/.test(version)) notFound()
  const search = { get: (key: string) => (typeof query[key] === 'string' ? query[key] : null) }
  const test = readTestReturn(query)
  return (
    <VersionSnapshot
      workspaceId={workspaceId}
      workflowId={workflowId}
      version={Number(version)}
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
              href: platformHref(
                workspacePath(workspaceId, `workflows/${encodeURIComponent(workflowId)}`),
                search
              ),
              label: 'Workflow',
            }
      }
    />
  )
}
