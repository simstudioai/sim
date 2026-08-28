/**
 * Maps an AWS SDK error to a response status. Client faults (e.g.
 * PipelineNotFoundException, InvalidApprovalTokenException) keep the 4xx
 * status AWS reports via `$metadata`; everything else maps to 500.
 */
export function awsErrorStatus(error: unknown): number {
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
    ?.httpStatusCode
  return typeof status === 'number' && status >= 400 && status < 500 ? status : 500
}
