/**
 * Builds the standard response transformer for Vanta in-process operations.
 */
export function createVantaTransformResponse<R extends { success: boolean; output: unknown }>(
  fallbackError: string
) {
  return async (response: Response): Promise<R> => {
    const data = await response.json()
    if (!response.ok || data.success === false) {
      throw new Error(data.error || fallbackError)
    }
    return { success: true, output: data.output } as R
  }
}
