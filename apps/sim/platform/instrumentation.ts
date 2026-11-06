/** Runs when the server starts, so a misconfigured zone never takes a request. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { assertDeployableMode } = await import('@/platform/lib/data/mode')
  assertDeployableMode()
}
