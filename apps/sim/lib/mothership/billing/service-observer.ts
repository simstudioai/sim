import { AsyncLocalStorage } from 'node:async_hooks'

export type ServiceCostRecorder = (service: string, costUsd: number) => Promise<void>
interface ServiceCostScope {
  record: ServiceCostRecorder
  failed?: (error: string) => Promise<void>
}
const serviceRecorder = new AsyncLocalStorage<ServiceCostScope>()

/** Only trusted provider adapters report costs; model-visible output is never inspected. */
export function observeServiceCosts<T>(
  record: ServiceCostRecorder,
  execute: () => T,
  failed?: ServiceCostScope['failed']
): T {
  return serviceRecorder.run({ record, failed }, execute)
}

export async function recordServiceCost(service: string, costUsd: number): Promise<void> {
  if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error('Invalid provider service cost')
  if (costUsd > 0) await serviceRecorder.getStore()?.record(service, costUsd)
}

/** Provider pricing failures leave an explicit reconciliation item instead of a zero charge. */
export async function recordServiceMeteringFailure(error: string): Promise<void> {
  await serviceRecorder.getStore()?.failed?.(error)
}
