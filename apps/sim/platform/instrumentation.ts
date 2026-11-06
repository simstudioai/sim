/**
 * Runs when the server starts, so a misconfigured zone never takes a request. Throwing is not enough:
 * Next logs a failed `register()` and keeps the process up answering 500, which a supervisor reads as
 * running. Only exiting fails the deployment.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { assertDeployableMode } = await import('@/platform/lib/data/mode')
  try {
    assertDeployableMode()
  } catch (error) {
    const [{ createLogger }, { getErrorMessage }] = await Promise.all([
      import('@sim/logger'),
      import('@sim/utils/errors'),
    ])
    createLogger('PlatformZone').error('Refusing to start', { error: getErrorMessage(error) })
    process.exit(1)
  }
}
