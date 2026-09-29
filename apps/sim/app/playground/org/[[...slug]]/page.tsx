import { Suspense } from 'react'
import { ProtoPage } from '@/app/playground/org/components/proto-page'

export default async function OrgPrototypePage({
  params,
}: {
  params: Promise<{ slug?: string[] }>
}) {
  const { slug } = await params
  return (
    <Suspense
      fallback={<p className='p-6 text-[var(--text-muted)] text-caption'>Loading prototype…</p>}
    >
      <ProtoPage slug={slug} />
    </Suspense>
  )
}
