import { runBenchmarkComparisonContract } from '@/lib/api/contracts/benchmarks'
import { parseRequest } from '@/lib/api/server'
import { runBenchmarkComparison } from '@/lib/benchmarks/application/run-comparison'
import { withBenchmarkRunStream } from '@/lib/benchmarks/run-route'

export const POST = withBenchmarkRunStream(async (request, context) => {
  const parsed = await parseRequest(runBenchmarkComparisonContract, request, context)
  if (!parsed.success) return parsed.response
  const { params, body } = parsed.data
  return { organizationId: params.id, benchmarkId: params.benchmarkId, ...body }
}, runBenchmarkComparison.execute)
