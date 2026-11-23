import { mkdirSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SOURCE_TYPESCRIPT_VERSION } from '@sim/workflow-sdk/codegen'

/** The repository's own TypeScript, the release `SOURCE_TYPESCRIPT_VERSION` pins. */
const REPO_TYPESCRIPT = join(__dirname, '../../../../node_modules/typescript')

/**
 * Installs the pinned TypeScript into config directory `configDir` as a check's first run does,
 * by linking the repository's copy, so a check type-checks without reaching npm.
 */
export function provideTypescript(configDir: string): void {
  const installed = join(
    configDir,
    'cache/typescript',
    SOURCE_TYPESCRIPT_VERSION,
    'node_modules/typescript'
  )
  mkdirSync(dirname(installed), { recursive: true })
  symlinkSync(REPO_TYPESCRIPT, installed, 'dir')
}
