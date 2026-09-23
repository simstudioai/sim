'use client'

import { useState } from 'react'

/**
 * Hover and click highlighting shared by a chart and its legend.
 *
 * A selection whose series the current window no longer draws is ignored: otherwise
 * every layer would stay dimmed after a period change, with no legend entry left to
 * clear it.
 */
export function useLegendHighlight(seriesIds: readonly string[]) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const activeSelection = selectedId !== null && seriesIds.includes(selectedId) ? selectedId : null
  const highlightedId = hoveredId ?? activeSelection
  return {
    highlightedId,
    legendProps: {
      highlightedId,
      selectedId: activeSelection,
      onHighlight: setHoveredId,
      onSelect: setSelectedId,
    },
  }
}
