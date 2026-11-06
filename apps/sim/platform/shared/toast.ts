/** The legacy toast's options; each toaster honours what it can draw. */
interface ToastOptions {
  description?: string
  /** A stable id: raising it again replaces this notice instead of stacking another. */
  noticeId?: string
  action?: { label: string; onClick: () => void }
  onDismiss?: () => void
  onUserDismiss?: () => void
  duration?: number
  persistAcrossRoutes?: boolean
}

interface ToastInput extends ToastOptions {
  message: string
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info'
}

interface ToastSink {
  show(toast: ToastInput): string
  dismiss(id: string): void
}

let sink: ToastSink | null = null

function deliver(input: ToastInput): string {
  return sink?.show(input) ?? ''
}

function withVariant(variant: NonNullable<ToastInput['variant']>) {
  return (message: string, options?: ToastOptions) => deliver({ ...options, message, variant })
}

/**
 * The same call shape as the legacy `toast`, delivered to whichever toaster the surface connects: the
 * zone's notification tray or `/o`'s host toaster. A call with nothing connected is dropped.
 */
export const toast = Object.assign((input: ToastInput) => deliver(input), {
  success: withVariant('success'),
  error: withVariant('error'),
  warning: withVariant('warning'),
  info: withVariant('info'),
  dismiss: (id: string) => sink?.dismiss(id),
})

export function connectToastSink(next: ToastSink): () => void {
  sink = next
  return () => {
    if (sink === next) sink = null
  }
}
