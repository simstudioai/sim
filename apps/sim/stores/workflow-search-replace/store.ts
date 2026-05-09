'use client'

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface WorkflowSearchReplacePosition {
  x: number
  y: number
}

interface WorkflowSearchReplaceState {
  isOpen: boolean
  position: WorkflowSearchReplacePosition | null
  query: string
  replacement: string
  activeMatchId: string | null
  open: () => void
  close: () => void
  setPosition: (position: WorkflowSearchReplacePosition) => void
  setQuery: (query: string) => void
  setReplacement: (replacement: string) => void
  setActiveMatchId: (matchId: string | null) => void
}

export const useWorkflowSearchReplaceStore = create<WorkflowSearchReplaceState>()(
  devtools(
    (set) => ({
      isOpen: false,
      position: null,
      query: '',
      replacement: '',
      activeMatchId: null,
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false, activeMatchId: null }),
      setPosition: (position) => set({ position }),
      setQuery: (query) => set({ query }),
      setReplacement: (replacement) => set({ replacement }),
      setActiveMatchId: (activeMatchId) => set({ activeMatchId }),
    }),
    { name: 'workflow-search-replace-store' }
  )
)
