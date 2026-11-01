import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface InFlightUploadsState {
  /** Uploads started and not yet settled, across every page of the app. */
  count: number
  /** Counts one upload as in flight; the returned release ends it, and only the first call counts. */
  begin: () => () => void
}

/**
 * Uploads that outlive the page that started them: a mutation keeps sending
 * after in-app navigation unmounts its component, so the unload guard that
 * protects them reads this count from the workspace shell, not from the page.
 */
export const useInFlightUploadsStore = create<InFlightUploadsState>()(
  devtools(
    (set) => ({
      count: 0,
      begin: () => {
        set((state) => ({ count: state.count + 1 }), false, 'begin')
        let released = false
        return () => {
          if (released) return
          released = true
          set((state) => ({ count: state.count - 1 }), false, 'release')
        }
      },
    }),
    { name: 'in-flight-uploads-store' }
  )
)

/** Counts `work` as an in-flight upload until it settles, whether it resolves or rejects. */
export async function trackUpload<T>(work: () => Promise<T>): Promise<T> {
  const release = useInFlightUploadsStore.getState().begin()
  try {
    return await work()
  } finally {
    release()
  }
}
