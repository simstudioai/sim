'use client'

import { toast } from '@sim/emcn'
import { connectToastSink } from '@/platform/shared/toast'

/**
 * Sends the organization views' toasts to the host toaster. Connected as the module loads, not in an
 * effect: a view's own mount effect runs before any effect above it, and its toast must still show.
 */
connectToastSink({
  show: (input) => toast(input),
  dismiss: (id) => toast.dismiss(id),
})

export function OrganizationToastSink() {
  return null
}
