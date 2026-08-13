'use client'

import { createContext, useContext } from 'react'
import type { CanonicalModeOverrides } from '@/lib/workflows/subblocks/visibility'

export interface DependencyBlockContextValue {
  blockType: string
  canonicalModeOverrides: CanonicalModeOverrides | undefined
}

const DependencyBlockTypeContext = createContext<DependencyBlockContextValue | null>(null)

/** Provides a nested tool's block type and already-scoped canonical modes. */
export const DependencyBlockTypeProvider = DependencyBlockTypeContext.Provider

export const useDependencyBlockContext = () => useContext(DependencyBlockTypeContext)

export function getDependencyCanonicalModeOverrides(
  context: DependencyBlockContextValue | null,
  hostOverrides: CanonicalModeOverrides | undefined
): CanonicalModeOverrides | undefined {
  // A nested tool with no scoped mode must use legacy inference, not another tool's host keys.
  return context ? context.canonicalModeOverrides : hostOverrides
}
