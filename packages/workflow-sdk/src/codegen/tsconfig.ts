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
