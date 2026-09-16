export type DemoBeatId = 'describe' | 'plan' | 'build'

/**
 * The section's title, one per act of the scene: the agent being described,
 * Sim planning the work, then the workflow being built and governed.
 * `describe` is the server-rendered heading, so the section reads before the
 * loop mounts.
 */
export const DEMO_BEATS: Readonly<Record<DemoBeatId, string>> = {
  describe: 'Describe the agent.',
  plan: 'Sim plans the work.',
  build: 'Watch the workflow build.',
}
