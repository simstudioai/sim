import type { SandboxBroker } from '@/lib/execution/sandbox/types'

/** Isolate side: `__brokers.simApi({ operation, input })`, wrapped by the `sim-api-code` bootstrap as `sim.api.<operation>(input)`. */
export const simApiBroker: SandboxBroker = {
  name: 'simApi',
  handle(ctx, args) {
    if (!ctx.callSimApi) throw new Error('sim.api is not available in this run')
    return ctx.callSimApi(args)
  },
}
