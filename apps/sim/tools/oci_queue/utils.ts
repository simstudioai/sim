import type { OciQueueResponse } from '@/tools/oci_queue/types'

export async function transformOciQueueResponse(response: Response): Promise<OciQueueResponse> {
  return response.json()
}
