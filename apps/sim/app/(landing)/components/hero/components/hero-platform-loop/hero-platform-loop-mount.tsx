'use client'

import dynamic from 'next/dynamic'

/** Loads the interactive demo independently of the server-rendered hero copy and artwork. */
const HeroPlatformLoop = dynamic(
  () =>
    import('@/app/(landing)/components/hero/components/hero-platform-loop/hero-platform-loop').then(
      (mod) => mod.HeroPlatformLoop
    ),
  { ssr: false }
)

/** Client mount for the hero's product loop; keeps {@link HeroPlatformStage} a Server Component. */
export function HeroPlatformLoopMount() {
  return <HeroPlatformLoop />
}
