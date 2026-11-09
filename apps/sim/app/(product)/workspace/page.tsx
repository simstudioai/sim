import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { platformHref } from '@/platform/lib/navigation'

export const metadata: Metadata = { title: 'Workspace' }

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

/**
 * The bare workspace URL, where sign-in, emails and the desktop app send a viewer: their last
 * workspace, a workflow they were sent to, or their first workspace once it is created.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const read = (key: string) => (typeof query[key] === 'string' ? query[key] : null)
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const { FIXTURE_ORGANIZATION_ID } = await import('@/platform/fixtures')
    redirect(platformHref(`/o/${FIXTURE_ORGANIZATION_ID}/home`, { get: read }))
  }
  const [{ resolveWorkspaceEntry }, { WorkspaceEntry }] = await Promise.all([
    import('@/platform/lib/data/workspace-entry'),
    import('@/app/(product)/workspace/_components/workspace-entry/workspace-entry'),
  ])
  const decision = await resolveWorkspaceEntry({
    redirectWorkflow: read('redirect_workflow'),
    redirect: read('redirect'),
    reason: read('reason'),
  })
  if (decision.kind === 'redirect') redirect(decision.href)
  return <WorkspaceEntry decision={decision} />
}
