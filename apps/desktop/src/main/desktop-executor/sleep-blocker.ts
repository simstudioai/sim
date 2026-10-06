/**
 * Keeps the machine from idle-sleeping while a chat has desktop work running in the background,
 * and only then. It cannot keep a closed laptop awake: the OS sleeps it anyway, and the work
 * resumes reporting when it wakes.
 */

interface PowerSaveBlocker {
  start(type: 'prevent-app-suspension'): number
  stop(id: number): void
  isStarted(id: number): boolean
}

interface SleepBlockerDeps {
  /** The user's "prevent sleep while a chat is running" switch. */
  enabled: () => boolean
  powerSaveBlocker: PowerSaveBlocker
}

export function createSleepBlocker(deps: SleepBlockerDeps) {
  let busy = false
  let blockerId: number | null = null

  const apply = () => {
    const wanted = busy && deps.enabled()
    const held = blockerId !== null && deps.powerSaveBlocker.isStarted(blockerId)
    if (wanted && !held) {
      blockerId = deps.powerSaveBlocker.start('prevent-app-suspension')
    } else if (!wanted && blockerId !== null) {
      if (held) deps.powerSaveBlocker.stop(blockerId)
      blockerId = null
    }
  }

  return {
    /** Whether any chat has desktop work claimed on this machine. */
    setBusy(next: boolean): void {
      busy = next
      apply()
    },
    /** Re-applies the user's switch to the work running now. */
    refresh(): void {
      apply()
    },
  }
}
