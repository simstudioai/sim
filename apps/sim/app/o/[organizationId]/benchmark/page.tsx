import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { isBenchmarkEnabled } from '@/lib/benchmarks/config'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { Benchmark } from '@/app/o/[organizationId]/benchmark/benchmark'
import BenchmarkLoading from '@/app/o/[organizationId]/benchmark/loading'

export const metadata: Metadata = { title: 'Benchmark' }

interface BenchmarkPageProps {
  params: Promise<{ organizationId: string }>
}

export default async function BenchmarkPage({ params }: BenchmarkPageProps) {
  if (!isBenchmarkEnabled()) notFound()
  const { organizationId } = await params
  const session = await getSession()
  if (!session?.user?.id) notFound()
  const context = await getOrganizationSurfaceContext(organizationId, session.user.id)
  if (!context?.mothershipAvailable) notFound()

  return (
    <Suspense fallback={<BenchmarkLoading />}>
      <Benchmark organizationId={organizationId} canPlan={context.canBuild} />
    </Suspense>
  )
}
