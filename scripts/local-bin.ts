import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Absolute path to a locally-installed executable.
 *
 * Scripts spawn these instead of shelling out through `bunx`, which re-resolves the package on
 * every call against the shared install cache — a network-backed sticky-disk mount on CI. That
 * is cheap for a lone caller and serializes badly once the audits run concurrently: it took the
 * desktop-bridge audit from 1s to 39s and made it the entire wall clock of the batch.
 *
 * `tsc` resolves here to the native TypeScript 7 compiler, which `check:native-typecheck`
 * asserts — so this is the one path guarded against the bin-shadowing that otherwise silently
 * selects the ~10x slower JavaScript compiler.
 */
export function localBin(name: string): string {
  return path.join(ROOT, 'node_modules', '.bin', name)
}
