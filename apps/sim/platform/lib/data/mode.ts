import 'server-only'

/** Where a build's data comes from: the fixture build's example data, or live reads. */
export type PlatformMode = 'fixture' | 'live'

/**
 * Where this build's data comes from. Example data renders with no sign-in, so this is a build-time
 * switch: `next.config.ts` lists `SIM_PLATFORM_FIXTURES` in its `env`, which inlines the value the
 * build (or `next dev`) started with into every bundle. A normal build compiles this to `live`, and
 * no environment on the server that runs it can turn it back. A gate that only answers not found
 * reads this; a branch that imports fixture code tests `process.env.SIM_PLATFORM_FIXTURES === '1'`
 * inline, since the bundler drops a branch, with the modules it imports, only when its condition
 * is a constant in that module.
 */
export function resolvePlatformMode(): PlatformMode {
  return process.env.SIM_PLATFORM_FIXTURES === '1' ? 'fixture' : 'live'
}
