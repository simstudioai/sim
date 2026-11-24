import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SOURCE_TYPESCRIPT_VERSION } from '@sim/workflow-sdk/codegen'

/** The repository's own TypeScript, the release `SOURCE_TYPESCRIPT_VERSION` pins. */
const REPO_TYPESCRIPT = join(__dirname, '../../../../node_modules/typescript')

/**
 * Installs the pinned TypeScript into config directory `configDir` as a check's first run does,
 * by linking the repository's copy, so a check type-checks without reaching npm.
 */
export function provideTypescript(configDir: string): void {
  const installed = installedPath(configDir)
  mkdirSync(dirname(installed), { recursive: true })
  symlinkSync(REPO_TYPESCRIPT, installed, 'dir')
}

function installedPath(configDir: string): string {
  return join(configDir, 'cache/typescript', SOURCE_TYPESCRIPT_VERSION, 'node_modules/typescript')
}

/**
 * Installs, in place of the pinned TypeScript, a `tsc` that prints `stdout` and exits 2, as tsc
 * does on errors: for output real sources rarely produce (a cut-off flood, a project error chain).
 */
export function provideTscPrinting(configDir: string, stdout: string): void {
  const installed = installedPath(configDir)
  mkdirSync(join(installed, 'bin'), { recursive: true })
  writeFileSync(join(installed, 'output.txt'), stdout)
  writeFileSync(
    join(installed, 'bin/tsc'),
    "const { readFileSync } = require('node:fs')\nprocess.stdout.write(readFileSync(require('node:path').join(__dirname, '../output.txt'), 'utf8'), () => process.exit(2))\n"
  )
}
