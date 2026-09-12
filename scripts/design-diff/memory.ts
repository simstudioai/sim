/** Reclaims short-lived parser trees between batches in the supported Bun CLI runtime. */
export function reclaimMemory(): void {
  const runtime = globalThis as typeof globalThis & {
    Bun?: { gc(synchronous: boolean): number }
  }
  runtime.Bun?.gc(true)
}
