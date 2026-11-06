import { runBenchmarkStageContract } from '@/lib/api/contracts/benchmarks'
import { parseRequest } from '@/lib/api/server'
import { runBenchmarkStage } from '@/lib/benchmarks/application/run-stage'
import { withBenchmarkRunStream } from '@/lib/benchmarks/run-route'

export const POST = withBenchmarkRunStream(async (request, context) => {
  const parsed = await parseRequest(runBenchmarkStageContract, request, context)
  if (!parsed.success) return parsed.response
  const { params, body } = parsed.data
  return { organizationId: params.id, benchmarkId: params.benchmarkId, ...body }
}, runBenchmarkStage.execute)
