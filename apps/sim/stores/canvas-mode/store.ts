import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export type CanvasMode = 'cursor' | 'hand'

interface CanvasModeState {
  mode: CanvasMode
  setMode: (mode: CanvasMode) => void
}

export const useCanvasModeStore = create<CanvasModeState>()(
  devtools(
    persist(
      (set) => ({
        mode: 'hand',
        setMode: (mode) => set({ mode }),
      }),
      { name: 'canvas-mode', partialize: (state) => ({ mode: state.mode }) }
    ),
    { name: 'canvas-mode-store' }
  )
)
