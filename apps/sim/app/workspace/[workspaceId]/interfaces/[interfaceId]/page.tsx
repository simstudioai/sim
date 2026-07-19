import { Suspense } from 'react'
import type { Metadata } from 'next'
import InterfaceLoading from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/loading'
import { Interface } from './interface'

export const metadata: Metadata = {
  title: 'Interface',
}

/**
 * Interface-detail page entry. `Interface` reads the `mode` / `module` URL
 * query params via nuqs (which uses `useSearchParams` internally), so it must
 * sit under a Suspense boundary. The fallback renders the real chrome so a
 * suspend never shows a blank frame.
 */
export default function InterfacePage() {
  return (
    <Suspense fallback={<InterfaceLoading />}>
      <Interface />
    </Suspense>
  )
}
