import type { OciNotificationsResponse } from '@/tools/oci_notifications/types'

export async function transformOciNotificationsResponse(
  response: Response
): Promise<OciNotificationsResponse> {
  return response.json()
}
