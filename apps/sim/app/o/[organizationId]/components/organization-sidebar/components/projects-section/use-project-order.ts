'use client'

import { useCallback, useState } from 'react'
import type { Project } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { usePinnedWorkspaceIds } from '@/hooks/queries/workspace'
import { orderProjectIds, useProjectOrderStore } from '@/stores/project-order/store'

/** Where a dragged project would land relative to the row under the pointer. */
export interface ProjectDropIndicator {
  projectId: string
  position: 'before' | 'after'
}

/** Drag handlers a project row binds; `indicator` is set while its row is the drop target. */
export interface ProjectDragProps {
  isDragging: boolean
  indicator: 'before' | 'after' | null
  onDragStart: () => void
  onDragOver: (event: React.DragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onDrop: (event: React.DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}

/**
 * The sidebar's project list in the viewer's order: pinned projects first, then the manual
 * order, then everything the order does not know yet. Also owns the drag-to-reorder state
 * the rows bind; a drop moves the dragged project before or after the row it landed on.
 */
export function useProjectOrder(roots: readonly Project[]) {
  const { data: pinnedIds } = usePinnedWorkspaceIds()
  const order = useProjectOrderStore((state) => state.order)
  const moveProject = useProjectOrderStore((state) => state.moveProject)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<ProjectDropIndicator | null>(null)

  const byId = new Map(roots.map((project) => [project.id, project]))
  const ordered = orderProjectIds(
    roots.map((project) => project.id),
    order
  ).map((id) => byId.get(id)!)
  const pinned = ordered.filter((project) => pinnedIds?.has(project.rootId))
  const unpinned = ordered.filter((project) => !pinnedIds?.has(project.rootId))
  const projects = [...pinned, ...unpinned]
  const visibleIds = projects.map((project) => project.id)

  const dragProps = useCallback(
    (project: Project): ProjectDragProps => ({
      isDragging: draggingId === project.id,
      indicator: dropIndicator?.projectId === project.id ? dropIndicator.position : null,
      onDragStart: () => setDraggingId(project.id),
      onDragOver: (event) => {
        if (!draggingId || draggingId === project.id) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const rect = event.currentTarget.getBoundingClientRect()
        const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
        setDropIndicator((current) =>
          current?.projectId === project.id && current.position === position
            ? current
            : { projectId: project.id, position }
        )
      },
      onDragLeave: () =>
        setDropIndicator((current) => (current?.projectId === project.id ? null : current)),
      onDrop: (event) => {
        event.preventDefault()
        if (!draggingId || draggingId === project.id) return
        const rect = event.currentTarget.getBoundingClientRect()
        const before = event.clientY < rect.top + rect.height / 2
        const index = visibleIds.indexOf(project.id)
        const beforeId = before ? project.id : (visibleIds[index + 1] ?? null)
        moveProject(visibleIds, draggingId, beforeId)
        setDraggingId(null)
        setDropIndicator(null)
      },
      onDragEnd: () => {
        setDraggingId(null)
        setDropIndicator(null)
      },
    }),
    [draggingId, dropIndicator, moveProject, visibleIds]
  )

  return { projects, dragProps, isAnyDragActive: draggingId !== null }
}
