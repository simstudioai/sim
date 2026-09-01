import { redirect } from 'next/navigation'
import { isChatEnabled } from '@/lib/core/config/env-flags'
import { inter } from '@/app/_styles/fonts/inter/inter'

/**
 * Redirects rather than 404s when Chat is disabled: this path is baked into
 * already-delivered invitation emails and into the invitation-accept API
 * contract, so it has to keep resolving. `/workspace/{id}` re-resolves the
 * landing route server-side, so the visitor lands on a workflow instead.
 */
export default async function HomeLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceId: string }>
}) {
  if (!isChatEnabled) {
    const { workspaceId } = await params
    redirect(`/workspace/${workspaceId}`)
  }

  return (
    <div className={`flex h-full flex-1 flex-col overflow-hidden ${inter.variable}`}>
      {children}
    </div>
  )
}
