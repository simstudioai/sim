import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { BlockCatalog } from '@sim/workflow-code'
import { generateSdkTypes, SOURCE_COMPILER_OPTIONS } from '@sim/workflow-sdk/codegen'

const REPO_ROOT = path.resolve(process.cwd(), '../..')
/** The SDK package, whose `src/core.d.ts` every type-check resolves `@sim/workflow-sdk` to. */
export const SDK_ROOT = path.join(REPO_ROOT, 'packages/workflow-sdk')

/** Writes the SDK declarations generated from `catalog` under `<dir>/types`, and returns them. */
export function writeSdkTypes(dir: string, catalog: BlockCatalog) {
  const files = generateSdkTypes(catalog)
  for (const file of files) {
    const target = path.join(dir, 'types', file.path)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, file.text)
  }
  return files
}

/**
 * Type-checks `include` against `core.d.ts` (and the workspace declaration SDK, for workspace
 * source declarations) and the declarations under `<dir>/types` with the
 * workspace compiler and the options every source directory gets. Returns the compiler's output:
 * empty when everything checks.
 */
export function typeCheckAgainstSdk(dir: string, name: string, include: string[]): string {
  const tsconfig = path.join(dir, `tsconfig.${name}.json`)
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        ...SOURCE_COMPILER_OPTIONS,
        skipLibCheck: false,
        paths: {
          '@sim/workflow-sdk': [path.join(SDK_ROOT, 'src/core.d.ts')],
          '@sim/workflow-sdk/workspace': [path.join(SDK_ROOT, 'src/workspace/index.d.ts')],
        },
      },
      include: [path.join(dir, 'types/**/*.d.ts'), ...include],
    })
  )
  try {
    execFileSync(path.join(REPO_ROOT, 'node_modules/.bin/tsc'), ['--noEmit', '-p', tsconfig], {
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 64 * 1024 * 1024,
    })
    return ''
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`
  }
}
