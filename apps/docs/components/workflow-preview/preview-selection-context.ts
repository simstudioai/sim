'use client'

import { createContext } from 'react'

export const PreviewSelectionContext = createContext<((blockId: string) => void) | undefined>(
  undefined
)
