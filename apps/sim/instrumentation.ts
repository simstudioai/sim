export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-server')
  }

  if (typeof window !== 'undefined') {
    await import('./instrumentation-client')
  }
}
