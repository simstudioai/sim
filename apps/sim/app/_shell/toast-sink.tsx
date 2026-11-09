'use client'

import { toast } from '@sim/emcn-legacy'
import { connectToastSink } from '@/lib/toast/sink'

/**
 * Sends toasts raised through `@/lib/toast/sink` (query hooks and other modules shared with the
 * Platform) to the site's legacy toaster. Connected as the module loads, not in an effect: a view's own
 * mount effect runs before any effect above it, and its toast must still show.
 */
connectToastSink({
  show: (input) => toast(input),
  dismiss: (id) => toast.dismiss(id),
})

export function ToastSink() {
  return null
}
