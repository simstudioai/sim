export function parseProcessGroupIds(rawValue: string | undefined): number[] {
  return (rawValue ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0)
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
