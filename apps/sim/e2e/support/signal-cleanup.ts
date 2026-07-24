export function parseProcessGroupIds(rawValue: string | undefined): number[] {
  return (rawValue ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0)
}

export interface SingleFlightSignalCleanup {
  isStarted(): boolean
  claimNormalFinalization(): boolean
  start(signal: NodeJS.Signals): Promise<void>
}

export function createSingleFlightSignalCleanup(
  cleanup: (signal: NodeJS.Signals) => Promise<void>
): SingleFlightSignalCleanup {
  let finalizationOwner: 'none' | 'normal' | 'signal' = 'none'
  let cleanupPromise: Promise<void> | null = null
  return {
    isStarted: () => finalizationOwner === 'signal',
    claimNormalFinalization() {
      if (finalizationOwner !== 'none') return false
      finalizationOwner = 'normal'
      return true
    },
    start(signal) {
      if (finalizationOwner === 'normal') return Promise.resolve()
      finalizationOwner = 'signal'
      cleanupPromise ??= Promise.resolve().then(() => cleanup(signal))
      return cleanupPromise
    },
  }
}

export function isProcessGroupAlive(groupId: number): boolean {
  if (!Number.isInteger(groupId) || groupId <= 0) return false
  try {
    if (process.platform !== 'win32') process.kill(-groupId, 0)
    else process.kill(groupId, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
