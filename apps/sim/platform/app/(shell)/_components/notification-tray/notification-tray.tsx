import { toast } from '@sim/emcn'
import type { ShellNotice } from '@/platform/app/(shell)/_components/model'

type Notice = Omit<ShellNotice, 'href'> & { onAction?: () => void }

/** The notices a toast is showing, so re-raising or dismissing a notice id reaches its toast. */
const toastIdByNotice = new Map<string, string>()

function dismiss(id: string) {
  const toastId = toastIdByNotice.get(id)
  if (toastId) toast.dismiss(toastId)
}

function notify({ id, title, description, action, onAction }: Notice) {
  dismiss(id)
  const toastId = toast({
    message: title,
    description,
    action: action && onAction ? { label: action, onClick: onAction } : undefined,
    onDismiss: () => {
      if (toastIdByNotice.get(id) === toastId) toastIdByNotice.delete(id)
    },
  })
  toastIdByNotice.set(id, toastId)
}

const NOTICES = { notify, dismiss }

/**
 * Delivers design-system notices through the app's existing toast stack, in place of the Platform
 * shell's tray. Same module path and hook as the tray, so ported components stay unchanged.
 */
export function usePlatformNotices() {
  return NOTICES
}
