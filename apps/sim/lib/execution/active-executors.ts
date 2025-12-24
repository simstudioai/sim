import { getCancellationAdapter } from './storage'

export async function requestCancellation(executionId: string): Promise<boolean> {
  return getCancellationAdapter().requestCancellation(executionId)
}

export async function isCancellationRequested(executionId: string): Promise<boolean> {
  return getCancellationAdapter().isCancellationRequested(executionId)
}

export async function clearCancellation(executionId: string): Promise<void> {
  return getCancellationAdapter().clearCancellation(executionId)
}
