import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

/** The composer's model-effort dial, forwarded per request to the mothership. */
export type MothershipEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const MOTHERSHIP_EFFORT_OPTIONS: Array<{ value: MothershipEffort; label: string }> = [
  { value: 'low', label: 'Low effort' },
  { value: 'medium', label: 'Medium effort' },
  { value: 'high', label: 'High effort' },
  { value: 'xhigh', label: 'X-high effort' },
  { value: 'max', label: 'Max effort' },
]

interface MothershipEffortState {
  effort: MothershipEffort
  setEffort: (effort: MothershipEffort) => void
}

export const useMothershipEffortStore = create<MothershipEffortState>()(
  devtools(
    persist(
      (set) => ({
        effort: 'high',
        setEffort: (effort) => set({ effort }),
      }),
      { name: 'mothership-effort' }
    ),
    { name: 'mothership-effort-store' }
  )
)
