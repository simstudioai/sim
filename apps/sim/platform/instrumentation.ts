/** Runs when the server starts, so a misconfigured zone never takes a request. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { exitUnlessDeployable } = await import('@/platform/lib/data/startup')
  exitUnlessDeployable()
}
