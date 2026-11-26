/** BENCHMARK HARNESS ONLY: turns the per-org `people` flag on (staging AppConfig is unreachable without SSO). */
import { plugin } from 'bun'

plugin({
  name: 'bench-people-flag',
  setup(build) {
    build.onLoad({ filter: /lib\/people\/feature-flag\.ts$/ }, async (args) => {
      const source = await Bun.file(args.path).text()
      const patched = source.replace(
        "return isFeatureEnabled('people', { orgId: organizationId })",
        'return Promise.resolve(true)'
      )
      if (patched === source) throw new Error('bench-people-flag: patch target not found')
      return { loader: 'ts', contents: patched }
    })
  },
})
