import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

/** A request that the table switch to one of its saved views. */
export interface TableViewPin {
  viewId: string
  /** Distinguishes a repeat pin of the same view — a re-edit after the user moved on — from one already honoured. */
  seq: number
}

interface TableViewPinState {
  /** Pending pins keyed by table id. */
  pins: Record<string, TableViewPin>
  nextSeq: number
  /** Asks the table to open on `viewId`; replaces any pin still pending for it. */
  pin: (tableId: string, viewId: string) => void
  /** Clears a pin the table has applied. A newer pin (higher seq) issued meanwhile is kept. */
  consume: (tableId: string, seq: number) => void
  reset: () => void
}

const initialState = { pins: {} as Record<string, TableViewPin>, nextSeq: 1 }

/**
 * Bridges the agent's saved-view work to the embedded table. A view the agent
 * just created or edited arrives on the resource stream before the table's
 * views query has refetched, so the switch can't be a plain URL write — the
 * table would treat the not-yet-listed id as dead and fall back to its default.
 * The pin waits here until the table (mounted now or later) sees the view in
 * its list, applies it, and consumes the pin.
 *
 * Ephemeral — no persistence. Reopening a chat restores a pin from the stored
 * resource's `viewId` instead.
 */
export const useTableViewPinStore = create<TableViewPinState>()(
  devtools(
    (set) => ({
      ...initialState,
      pin: (tableId, viewId) =>
        set((state) => ({
          pins: { ...state.pins, [tableId]: { viewId, seq: state.nextSeq } },
          nextSeq: state.nextSeq + 1,
        })),
      consume: (tableId, seq) =>
        set((state) => {
          const pending = state.pins[tableId]
          if (!pending || pending.seq !== seq) return state
          const { [tableId]: _consumed, ...pins } = state.pins
          return { pins }
        }),
      reset: () => set(initialState),
    }),
    { name: 'table-view-pin-store' }
  )
)
