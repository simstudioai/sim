import { Suspense } from 'react'
import { ProtoPage } from '@/app/playground/org/components/proto-page'

/** Project pages: the same client router as the catch-all, with the workspace as a real segment. */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ workspaceId: string; rest?: string[] }>
}) {
  const { workspaceId, rest } = await params
  return (
    <Suspense
      fallback={<p className='p-6 text-[var(--text-muted)] text-caption'>Loading project…</p>}
    >
      <ProtoPage slug={['p', workspaceId, ...(rest ?? [])]} />
    </Suspense>
  )
}
