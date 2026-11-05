import type { ReactNode } from 'react'
import { type DehydratedState, HydrationBoundary } from '@tanstack/react-query'

interface HydratedProps {
  state: Promise<DehydratedState>
  children: ReactNode
}

/**
 * Children painted from a page's server reads. Put it inside a `Suspense`: it holds only that
 * boundary, so the page's arrangement paints before the reads settle.
 */
export async function Hydrated({ state, children }: HydratedProps) {
  return <HydrationBoundary state={await state}>{children}</HydrationBoundary>
}
