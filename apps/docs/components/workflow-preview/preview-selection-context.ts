'use client'

import { createContext, type ReactNode } from 'react'

interface PreviewSelection {
  selectBlock?: (blockId: string) => void
  renderDetails: (blockId: string) => ReactNode
}

export const PreviewSelectionContext = createContext<PreviewSelection>({
  renderDetails: () => null,
})
