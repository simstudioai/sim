import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type {
  VariablesDimensions,
  VariablesModalStore,
  VariablesPosition,
} from '@/stores/variables/types'

/**
 * Floating variables modal default dimensions.
 * Slightly larger than the chat modal for more comfortable editing.
 */
const DEFAULT_WIDTH = 320
const DEFAULT_HEIGHT = 320

/**
 * Minimum and maximum modal dimensions.
 */
export const MIN_VARIABLES_WIDTH = DEFAULT_WIDTH
export const MIN_VARIABLES_HEIGHT = DEFAULT_HEIGHT
export const MAX_VARIABLES_WIDTH = 500
export const MAX_VARIABLES_HEIGHT = 600

/** Inset gap between the viewport edge and the content window */
const CONTENT_WINDOW_GAP = 8

/**
 * Compute a center-biased default position, factoring in current layout chrome
 * (sidebar, right panel, terminal) and content window inset.
 */
const calculateDefaultPosition = (): VariablesPosition => {
  if (typeof window === 'undefined') {
    return { x: 100, y: 100 }
  }

  const sidebarWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width') || '0'
  )
  const panelWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
  )
  const terminalHeight = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--terminal-height') || '0'
  )

  const availableWidth = window.innerWidth - sidebarWidth - CONTENT_WINDOW_GAP - panelWidth
  const availableHeight = window.innerHeight - CONTENT_WINDOW_GAP * 2 - terminalHeight
  const x = sidebarWidth + (availableWidth - DEFAULT_WIDTH) / 2
  const y = CONTENT_WINDOW_GAP + (availableHeight - DEFAULT_HEIGHT) / 2
  return { x, y }
}

/**
 * Constrain a position to the visible canvas, considering layout chrome.
 */
const constrainPosition = (
  position: VariablesPosition,
  width: number = DEFAULT_WIDTH,
  height: number = DEFAULT_HEIGHT
): VariablesPosition => {
  if (typeof window === 'undefined') return position

  const sidebarWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width') || '0'
  )
  const panelWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
  )
  const terminalHeight = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--terminal-height') || '0'
  )

  const minX = sidebarWidth
  const maxX = window.innerWidth - CONTENT_WINDOW_GAP - panelWidth - width
  const minY = CONTENT_WINDOW_GAP
  const maxY = window.innerHeight - CONTENT_WINDOW_GAP - terminalHeight - height

  return {
    x: Math.max(minX, Math.min(maxX, position.x)),
    y: Math.max(minY, Math.min(maxY, position.y)),
  }
}

/**
 * Return a valid, constrained position. If the stored one is off-bounds due to
 * layout changes, prefer a fresh default center position.
 */
export const getVariablesPosition = (
  stored: VariablesPosition | null,
  width: number = DEFAULT_WIDTH,
  height: number = DEFAULT_HEIGHT
): VariablesPosition => {
  if (!stored) return calculateDefaultPosition()
  const constrained = constrainPosition(stored, width, height)
  const deltaX = Math.abs(constrained.x - stored.x)
  const deltaY = Math.abs(constrained.y - stored.y)
  if (deltaX > 100 || deltaY > 100) return calculateDefaultPosition()
  return constrained
}

/**
 * UI-only store for the floating variables modal.
 * Variable data lives in the panel variables store (`@/stores/panel/variables`).
 */
export const useVariablesStore = create<VariablesModalStore>()(
  devtools(
    persist(
      (set) => ({
        isOpen: false,
        position: null,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,

        setIsOpen: (open) => set({ isOpen: open }),
        setPosition: (position) => set({ position }),
        setDimensions: (dimensions) =>
          set({
            width: Math.max(MIN_VARIABLES_WIDTH, Math.min(MAX_VARIABLES_WIDTH, dimensions.width)),
            height: Math.max(
              MIN_VARIABLES_HEIGHT,
              Math.min(MAX_VARIABLES_HEIGHT, dimensions.height)
            ),
          }),
        resetPosition: () => set({ position: null }),
      }),
      {
        name: 'variables-modal-store',
        partialize: (state) => ({
          position: state.position,
          width: state.width,
          height: state.height,
        }),
      }
    ),
    { name: 'variables-modal-store' }
  )
)

/**
 * Get default floating variables modal dimensions.
 */
export const getDefaultVariablesDimensions = (): VariablesDimensions => ({
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
})
