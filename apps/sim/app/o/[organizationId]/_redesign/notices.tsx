'use client'

import { type ReactNode, useEffect } from 'react'
import { toast } from '@sim/emcn'
import {
  HostNoticesProvider,
  type NoticeInput,
  type PlatformNotices,
} from '@/platform/app/(shell)/_components/notification-tray/notification-tray'
import { connectToastSink } from '@/platform/lib/data/toast'

/** The notices a toast is showing, so re-raising or dismissing a notice id reaches its toast. */
const toastIdByNotice = new Map<string, string>()

function dismiss(id: string) {
  const toastId = toastIdByNotice.get(id)
  if (toastId) toast.dismiss(toastId)
}

function notify({ id, title, description, action, onAction, variant }: NoticeInput) {
  dismiss(id)
  const toastId = toast({
    message: title,
    description,
    variant,
    action: action && onAction ? { label: action, onClick: onAction } : undefined,
    onDismiss: () => {
      if (toastIdByNotice.get(id) === toastId) toastIdByNotice.delete(id)
    },
  })
  toastIdByNotice.set(id, toastId)
}

const NOTICES: PlatformNotices = { notify, dismiss }

/**
 * Delivers design-system notices through the app's toast stack, in place of the Platform shell's
 * tray, and the toasts `lib/data` raises along with them.
 */
export function RedesignNotices({ children }: { children: ReactNode }) {
  useEffect(
    () =>
      connectToastSink({
        show: ({ variant, ...input }) =>
          toast({ ...input, variant: variant === 'warning' ? 'error' : variant }),
        dismiss: (id) => toast.dismiss(id),
      }),
    []
  )
  return <HostNoticesProvider value={NOTICES}>{children}</HostNoticesProvider>
}
