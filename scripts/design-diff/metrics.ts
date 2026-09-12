import { AsyncLocalStorage } from 'node:async_hooks'

/** Measurements are separate from deterministic findings and never contain source text. */
export class Metrics {
  readonly stages: Record<string, { calls: number; milliseconds: number }> = {}
  readonly counters: Record<string, number> = {}
  private readonly started = performance.now()

  count(name: string, amount = 1): void {
    this.counters[name] = (this.counters[name] ?? 0) + amount
  }

  measure<T>(name: string, operation: () => T): T {
    const started = performance.now()
    try {
      return operation()
    } finally {
      const stage = this.stages[name] ?? { calls: 0, milliseconds: 0 }
      stage.calls++
      stage.milliseconds += performance.now() - started
      this.stages[name] = stage
    }
  }

  snapshot() {
    return {
      elapsedMilliseconds: performance.now() - this.started,
      peakMemoryBytes: process.resourceUsage().maxRSS * 1024,
      stages: this.stages,
      counters: this.counters,
    }
  }
}

export const measurements = new AsyncLocalStorage<Metrics>()

export function measured<T>(stage: string, operation: () => T): T {
  const metrics = measurements.getStore()
  return metrics ? metrics.measure(stage, operation) : operation()
}

export function counted(name: string, amount = 1): void {
  measurements.getStore()?.count(name, amount)
}
