import { type Counter, type Histogram, metrics } from '@opentelemetry/api'

export type ExecutionTimeoutSource =
  | 'plan_default'
  | 'enterprise_metadata'
  | 'async_request_override'
  | 'unbounded'

export type ExecutionCancellationBackend = 'trigger_dev' | 'database' | 'in_process'
export type ExecutionCancellationResult = 'cancelled' | 'not_found' | 'error'

interface ExecutionTimeoutInstruments {
  resolutions: Counter
  effectiveDuration: Histogram
  cancellations: Counter
  sandboxProviderLimits: Counter
  sandboxTeardownFailures: Counter
  sandboxImageCleanupFailures: Counter
  sandboxCliBuildFailures: Counter
}

let cached: ExecutionTimeoutInstruments | undefined

function instruments(): ExecutionTimeoutInstruments {
  if (cached) return cached
  const meter = metrics.getMeter('sim-execution')
  cached = {
    resolutions: meter.createCounter('sim.execution.timeout.resolutions'),
    effectiveDuration: meter.createHistogram('sim.execution.timeout.effective', {
      unit: 's',
      advice: {
        explicitBucketBoundaries: [60, 300, 1800, 3600, 5400, 10800, 43200, 86400, 259200, 604800],
      },
    }),
    cancellations: meter.createCounter('sim.execution.cancellation.backend.results'),
    sandboxProviderLimits: meter.createCounter('sim.execution.sandbox.provider_limit'),
    sandboxTeardownFailures: meter.createCounter('sim.execution.sandbox.teardown.failures'),
    sandboxImageCleanupFailures: meter.createCounter(
      'sim.execution.sandbox.image_cleanup.failures'
    ),
    sandboxCliBuildFailures: meter.createCounter('sim.execution.sandbox.cli_build.failures'),
  }
  return cached
}

/** Emits one bounded-cardinality result for an execution cancellation backend attempt. */
export function recordExecutionCancellationBackendResult(params: {
  backend: ExecutionCancellationBackend
  result: ExecutionCancellationResult
}): void {
  instruments().cancellations.add(1, {
    'execution.cancellation.backend': params.backend,
    'execution.cancellation.result': params.result,
  })
}

/** Emits when a sandbox operation reaches a provider's bounded continuous-run limit. */
export function recordSandboxProviderLimit(params: {
  provider: 'e2b' | 'daytona'
  operation: 'code' | 'command'
}): void {
  instruments().sandboxProviderLimits.add(1, {
    'sandbox.provider': params.provider,
    'sandbox.operation': params.operation,
  })
}

/** Emits when best-effort sandbox teardown fails after a run or abort. */
export function recordSandboxTeardownFailure(params: {
  provider: 'e2b' | 'daytona'
  reason: 'cleanup' | 'cancellation' | 'timeout'
}): void {
  instruments().sandboxTeardownFailures.add(1, {
    'sandbox.provider': params.provider,
    'sandbox.teardown.reason': params.reason,
  })
}

/** Emits when best-effort cleanup cannot remove a retired provider image family. */
export function recordSandboxImageCleanupFailure(params: {
  provider: 'e2b' | 'daytona'
  reason: 'failed_candidate' | 'lost_claim' | 'superseded'
}): void {
  instruments().sandboxImageCleanupFailures.add(1, {
    'sandbox.provider': params.provider,
    'sandbox.image_cleanup.reason': params.reason,
  })
}

/** Emits when a prebuilt image containing curated CLI tools fails to build. */
export function recordSandboxCliBuildFailure(params: { provider: 'e2b' | 'daytona' }): void {
  instruments().sandboxCliBuildFailures.add(1, {
    'sandbox.provider': params.provider,
  })
}

/** Emits one bounded-cardinality observation for a resolved execution budget. */
export function recordExecutionTimeoutResolution(params: {
  source: ExecutionTimeoutSource
  executionType: 'sync' | 'async'
  effectiveTimeoutMs: number
}): void {
  const attributes = {
    'execution.timeout.source': params.source,
    'execution.type': params.executionType,
    'execution.timeout.bounded': params.effectiveTimeoutMs > 0,
  }
  const { resolutions, effectiveDuration } = instruments()
  resolutions.add(1, attributes)
  effectiveDuration.record(Math.max(0, params.effectiveTimeoutMs / 1000), attributes)
}
