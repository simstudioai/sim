import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { canUseBenchmarks } from '@/lib/benchmarks/config'
import { BenchmarkConsole } from '@/app/(site)/benchmark/benchmark-console'
import { BenchmarkConsoleLoading } from '@/app/(site)/benchmark/benchmark-loading'

export const metadata: Metadata = { title: 'Benchmarks' }

export default async function BenchmarkConsolePage() {
  const session = await getSession()
  if (!session?.user?.id || !(await canUseBenchmarks(session.user.id))) notFound()
  return (
    <Suspense fallback={<BenchmarkConsoleLoading />}>
      <BenchmarkConsole />
    </Suspense>
  )
}
