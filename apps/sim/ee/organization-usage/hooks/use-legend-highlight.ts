'use client'

import { useState } from 'react'

/**
 * Hover and click highlighting shared by a chart and its legend.
 *
 * A hover or selection whose series the current window no longer draws is cleared
 * during render: otherwise every layer would stay dimmed after a period change, with
 * no legend entry left to clear it, and a returning series would bring it back.
 */
export function useLegendHighlight(seriesIds: readonly string[]) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  if (hoveredId !== null && !seriesIds.includes(hoveredId)) setHoveredId(null)
  if (selectedId !== null && !seriesIds.includes(selectedId)) setSelectedId(null)
  const highlightedId = hoveredId ?? selectedId
  return {
    highlightedId,
    legendProps: {
      highlightedId,
      selectedId,
      onHighlight: setHoveredId,
      onSelect: setSelectedId,
    },
  }
}
