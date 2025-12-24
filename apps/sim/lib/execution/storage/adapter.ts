export interface CancellationStorageAdapter {
  requestCancellation(executionId: string): Promise<boolean>
  isCancellationRequested(executionId: string): Promise<boolean>
  clearCancellation(executionId: string): Promise<void>
  dispose(): void
}
