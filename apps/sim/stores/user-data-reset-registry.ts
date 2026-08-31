'use client'

const userDataResets = new Map<string, () => void>()

/** Registers a loaded client store for authenticated identity resets. */
export function registerUserDataReset(storeId: string, reset: () => void): void {
  userDataResets.set(storeId, reset)
}

/** Resets every identity-scoped store that is currently loaded. */
export function resetRegisteredUserData(): void {
  const errors: unknown[] = []
  userDataResets.forEach((reset) => {
    try {
      reset()
    } catch (error) {
      errors.push(error)
    }
  })
  if (errors.length > 0) throw errors[0]
}
