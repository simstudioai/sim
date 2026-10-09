import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Builds the native test dependencies on the platforms that implement them. */
export default function setup() {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    execFileSync('bun', ['run', 'scripts/build-native.ts'], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      stdio: 'inherit',
    })
  }
}
