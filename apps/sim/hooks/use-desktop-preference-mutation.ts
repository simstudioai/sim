import { useCallback, useRef, useState } from 'react'
import type { DesktopPreferences, SimDesktopApi } from '@sim/desktop-bridge'
import { toast } from '@sim/emcn'
import { getDesktopBridge, setDesktopPreferencesSnapshot } from '@/lib/desktop'

/**
 * The shared shape of every desktop-preference mutation: call a bridge
 * method, publish the returned preferences (to the caller's state and to the
 * module snapshot the synchronous desktop gates read), toast on failure, and
 * expose a per-action pending flag. Instantiate once per action so each
 * control disables independently.
 *
 * `run` returns the next preferences to publish, or nothing to skip
 * publishing without an error (e.g. the user cancelled a chooser dialog).
 * Throwing reports `errorMessage`.
 *
 * `mutate` is referentially stable across renders (the arguments are read
 * through refs), so it can be handed to memoized children directly.
 */
export function useDesktopPreferenceMutation<Args extends unknown[]>(
  run: (bridge: SimDesktopApi, ...args: Args) => Promise<DesktopPreferences | null | undefined>,
  errorMessage: string,
  onPreferences: (next: DesktopPreferences) => void
): { pending: boolean; mutate: (...args: Args) => Promise<void> } {
  const [pending, setPending] = useState(false)
  const configRef = useRef({ run, errorMessage, onPreferences })
  configRef.current = { run, errorMessage, onPreferences }

  const mutate = useCallback(async (...args: Args) => {
    const bridge = getDesktopBridge()
    if (!bridge) return
    setPending(true)
    try {
      const next = await configRef.current.run(bridge, ...args)
      if (!next) return
      configRef.current.onPreferences(next)
      setDesktopPreferencesSnapshot(next)
    } catch {
      toast.error(configRef.current.errorMessage)
    } finally {
      setPending(false)
    }
  }, [])

  return { pending, mutate }
}
