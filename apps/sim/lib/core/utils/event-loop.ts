const CPU_SLICE_MS = 10

let sliceEndsAt = 0
let turnScheduled = false
const turnQueue: Array<() => void> = []

/**
 * Cooperative yield for CPU-bound request work. Awaits settle as microtasks, which never let the
 * event loop service I/O, so a loop that only awaits holds the whole process until it finishes.
 * Call this between units of work: it returns immediately while the current slice lasts and
 * otherwise waits for a macrotask turn.
 *
 * The slice is process-wide and shared by every caller in the process, not per caller or per
 * request: each turn hands one fresh slice to one waiter. Releasing every waiter together would
 * let each finish its in-flight unit before I/O runs again, so a turn would grow with concurrency
 * instead of staying at one slice plus one unit.
 */
export async function yieldWhenSliceExpires(): Promise<void> {
  if (performance.now() < sliceEndsAt) return
  await new Promise<void>((resolve) => {
    turnQueue.push(resolve)
    scheduleTurn()
  })
}

function scheduleTurn(): void {
  if (turnScheduled) return
  turnScheduled = true
  setImmediate(() => {
    turnScheduled = false
    sliceEndsAt = performance.now() + CPU_SLICE_MS
    turnQueue.shift()?.()
    if (turnQueue.length > 0) scheduleTurn()
  })
}
