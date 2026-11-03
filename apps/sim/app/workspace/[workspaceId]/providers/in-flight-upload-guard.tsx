'use client'

import { useBeforeUnloadWhile } from '@/hooks/use-before-unload-while'
import { useInFlightUploadsStore } from '@/stores/in-flight-uploads/store'

/**
 * Asks before the page unloads while any upload is still sending. Mounted once in
 * the workspace layout, so it outlives the page that started the upload.
 */
export function InFlightUploadGuard() {
  const uploading = useInFlightUploadsStore((state) => state.count > 0)
  useBeforeUnloadWhile(uploading)
  return null
}
