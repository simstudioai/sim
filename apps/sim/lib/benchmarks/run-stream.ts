import { ApiClientError } from '@/lib/api/client/errors'
import { type BenchmarkResponse, benchmarkRunEventSchema } from '@/lib/api/contracts/benchmarks'

export async function readBenchmarkRunResponse(response: Response): Promise<BenchmarkResponse> {
  if (!response.body) throw new Error('Benchmark response has no stream')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      let newline = pending.indexOf('\n')
      while (newline >= 0) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        if (line.trim()) {
          const event = benchmarkRunEventSchema.parse(JSON.parse(line))
          if (event.type === 'result') return { benchmark: event.benchmark }
          if (event.type === 'error')
            throw new ApiClientError({ status: event.status, message: event.message, body: event })
        }
        newline = pending.indexOf('\n')
      }
      if (done)
        throw new Error(
          'Benchmark connection ended before a result arrived. Refresh to check saved progress.'
        )
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
