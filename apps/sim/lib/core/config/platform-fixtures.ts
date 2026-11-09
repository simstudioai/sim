/**
 * Whether this build renders Platform's example data instead of live reads. Example data renders
 * with no sign-in, so this is a build-time switch: `next.config.ts` lists `SIM_PLATFORM_FIXTURES`
 * in its `env`, which inlines the value the build (or `next dev`) started with into every bundle.
 * A normal build compiles this to `false`, and no environment on the server that runs it can turn
 * it back on.
 *
 * A branch that imports fixture code tests `process.env.SIM_PLATFORM_FIXTURES === '1'` inline
 * instead of calling this: the bundler drops a branch, with the modules it imports, only when its
 * condition is a constant in that module.
 */
export function isPlatformFixtureBuild(): boolean {
  return process.env.SIM_PLATFORM_FIXTURES === '1'
}
