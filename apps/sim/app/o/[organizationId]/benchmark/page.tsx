import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { canUseBenchmarks } from '@/lib/benchmarks/application/access'

export default async function BenchmarkPage({
  params,
}: {
  params: Promise<{ organizationId: string }>
}) {
  const session = await getSession()
  if (!session?.user?.id || !(await canUseBenchmarks(session.user.id))) notFound()
  const { organizationId } = await params
  redirect(`/benchmark?organization=${encodeURIComponent(organizationId)}`)
}
