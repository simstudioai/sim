'use client'

import dynamic from 'next/dynamic'

/**
 * `ssr: false` so the loop's client graph never enters the marketing layout's
 * initial bundle. The loop stages Sim's real chat presentation, and that
 * surface resolves tool calls against the full block registry - several
 * megabytes of client JavaScript that every landing route would otherwise
 * carry through the shared components barrel. No page copy lives inside the
 * loop, its frame reserves the box, and the painted backdrop is the LCP
 * element, so deferring it costs crawlers nothing and causes no layout shift.
 */
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
