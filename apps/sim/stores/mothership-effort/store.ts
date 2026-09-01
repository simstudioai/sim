import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

/** The composer's model-effort dial, forwarded per request to the mothership. */
export type MothershipEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const MOTHERSHIP_EFFORT_OPTIONS: Array<{ value: MothershipEffort; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-high' },
  { value: 'max', label: 'Max' },
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
