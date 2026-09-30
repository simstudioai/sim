import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface ProjectOrderState {
  /** Project (lineage root) ids in the order the viewer arranged them; unknown ids sort after. */
  order: string[]
  /** Places `projectId` before `beforeId`, or last when `beforeId` is null, over `visible`. */
  moveProject: (visible: readonly string[], projectId: string, beforeId: string | null) => void
}

/**
 * The viewer's manual order of projects in the organization sidebar. A per-browser preference
 * for now; graduation moves it beside the workspace pins on the server.
 */
export const useProjectOrderStore = create<ProjectOrderState>()(
  devtools(
    persist(
      (set) => ({
        order: [],
        moveProject: (visible, projectId, beforeId) =>
          set((state) => {
            const current = orderProjectIds(visible, state.order).filter((id) => id !== projectId)
            const index = beforeId ? current.indexOf(beforeId) : -1
            if (index === -1) current.push(projectId)
            else current.splice(index, 0, projectId)
            return { order: current }
          }),
      }),
      {
        name: 'project-order',
        partialize: (state) => ({ order: state.order }),
      }
    ),
    { name: 'project-order-store' }
  )
)

/** `ids` sorted by the stored order; ids the order does not know keep their given order after it. */
export function orderProjectIds(ids: readonly string[], order: readonly string[]): string[] {
  const rank = new Map(order.map((id, index) => [id, index]))
  const known = ids.filter((id) => rank.has(id)).sort((a, b) => rank.get(a)! - rank.get(b)!)
  const unknown = ids.filter((id) => !rank.has(id))
  return [...known, ...unknown]
}
