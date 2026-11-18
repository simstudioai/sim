/**
 * The compiler options a workflow source directory is type-checked with: the `tsconfig.json` the
 * CLI writes beside the generated declarations, and the SDK's own checks of those declarations.
 * Each adds its `paths` mapping for `@sim/workflow-sdk` and its `skipLibCheck`.
 */
export const SOURCE_COMPILER_OPTIONS = {
  target: 'ES2022',
  lib: ['ES2022'],
  module: 'ESNext',
  moduleResolution: 'bundler',
  moduleDetection: 'force',
  types: [],
  strict: true,
  noEmit: true,
} as const

/**
 * The TypeScript release a source directory is type-checked with: the one this repository checks
 * the generated declarations against. A directory has no `package.json`, so the command fetches
 * exactly this release instead of whatever `tsc` resolves to.
 */
const SOURCE_TYPESCRIPT_VERSION = '7.0.2'

/** The command that type-checks a source directory with `project` (a tsconfig path). */
export function typecheckCommand(project = '.'): string {
  return `bunx -p typescript@${SOURCE_TYPESCRIPT_VERSION} tsc -p ${project}`
}
