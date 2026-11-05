/** The parts of the legacy toast that query hooks use when a background mutation reports back. */
interface ToastOptions {
  description?: string
  action?: { label: string; onClick: () => void }
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
 * The same call shape as the legacy `toast`, delivered to the Platform's notification tray once the
 * shell connects it. A call with no shell mounted has nowhere to appear and is dropped.
 */
export const toast = Object.assign((input: ToastInput) => deliver(input), {
  success: withVariant('success'),
  error: withVariant('error'),
  warning: withVariant('warning'),
  info: withVariant('info'),
  dismiss: (id: string) => sink?.dismiss(id),
})

/** Connects the shell's notices. Returns the disconnect for an effect's cleanup. */
export function connectToastSink(next: ToastSink): () => void {
  sink = next
  return () => {
    if (sink === next) sink = null
  }
}
