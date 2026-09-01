import { spawnSync } from 'node:child_process'

/** Checks executable resolution without depending on a shell or Bun runtime. */
export function executableExists(command: string): boolean {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' })
  if (!result.error) return true
  return (result.error as NodeJS.ErrnoException).code !== 'ENOENT'
}
