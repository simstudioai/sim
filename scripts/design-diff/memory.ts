import { measured } from '#design-diff/metrics'

let lastHeap = 0

/** Reclaims short-lived parser trees between batches in the supported Bun CLI runtime. */
export function reclaimMemory(): void {
  const runtime = globalThis as typeof globalThis & {
    Bun?: { gc(synchronous: boolean): number }
  }
  if (!runtime.Bun) return
  const heap = process.memoryUsage().heapUsed
  if (heap < lastHeap + 256 * 1024 * 1024) return
  measured('garbageCollection', () => runtime.Bun!.gc(true))
  lastHeap = process.memoryUsage().heapUsed
}
