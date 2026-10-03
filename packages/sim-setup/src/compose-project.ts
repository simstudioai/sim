import { createHash } from 'node:crypto'
import path from 'node:path'

/** Returns the stable Docker Compose project name for a new standalone installation. */
export function standaloneComposeProjectName(root: string): string {
  const digest = createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 12)
  return `sim-${digest}`
}

/** Reproduces Compose's directory-derived identity for installs created before names were stored. */
export function legacyComposeProjectName(root: string): string {
  const name = path
    .basename(path.resolve(root))
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
  if (!/^[a-z0-9]/.test(name)) {
    throw new Error(
      `Cannot derive the existing Compose project name from ${root}; set COMPOSE_PROJECT_NAME in its .env file.`
    )
  }
  return name
}
