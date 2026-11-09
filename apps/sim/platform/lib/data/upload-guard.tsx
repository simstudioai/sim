'use client'

import { useBeforeUnloadWhile } from '@/hooks/use-before-unload-while'
import { useInFlightUploadsStore } from '@/stores/in-flight-uploads/store'

/**
 * Asks before the page unloads while any upload is still sending, as the legacy workspace layout
 * did. Mounted by the live workspace layout, so it outlives the page that started the upload: a
 * knowledge base upload keeps sending after in-app navigation unmounts its dialog.
 */
export function UploadGuard() {
  const uploading = useInFlightUploadsStore((state) => state.count > 0)
  useBeforeUnloadWhile(uploading)
  return null
}
