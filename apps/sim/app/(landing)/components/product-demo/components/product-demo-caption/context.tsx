'use client'

import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'
import type { DemoBeatId } from '@/app/(landing)/components/product-demo/components/product-demo-caption/beats'

interface ProductDemoBeatContextValue {
  /** The act the scene is in, which the caption's copy follows. */
  beat: DemoBeatId
  setBeat: (beat: DemoBeatId) => void
}

const ProductDemoBeatContext = createContext<ProductDemoBeatContextValue | null>(null)

/**
 * Shares the scene's current act between the loop, which drives it, and the
 * caption, which reads it. Starts on `describe`, the pair the server renders.
 */
export function ProductDemoBeatProvider({ children }: { children: ReactNode }) {
  const [beat, setBeat] = useState<DemoBeatId>('describe')
  const value = useMemo(() => ({ beat, setBeat }), [beat])
  return <ProductDemoBeatContext.Provider value={value}>{children}</ProductDemoBeatContext.Provider>
}

export function useProductDemoBeat(): ProductDemoBeatContextValue {
  const value = useContext(ProductDemoBeatContext)
  if (!value) throw new Error('useProductDemoBeat needs a ProductDemoBeatProvider above it')
  return value
}
