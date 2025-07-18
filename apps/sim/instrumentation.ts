export async function register() {
  console.log('[Main Instrumentation] register() called, environment:', {
    NEXT_RUNTIME: process.env.NEXT_RUNTIME,
    NODE_ENV: process.env.NODE_ENV,
  })

  // Load Node.js-specific instrumentation
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[Main Instrumentation] Loading Node.js instrumentation...')
    const nodeInstrumentation = await import('./instrumentation-node')
    if (nodeInstrumentation.register) {
      console.log('[Main Instrumentation] Calling Node.js register()...')
      await nodeInstrumentation.register()
    }
  }

  // Load Edge Runtime-specific instrumentation
  if (process.env.NEXT_RUNTIME === 'edge') {
    console.log('[Main Instrumentation] Loading Edge Runtime instrumentation...')
    const edgeInstrumentation = await import('./instrumentation-edge')
    if (edgeInstrumentation.register) {
      console.log('[Main Instrumentation] Calling Edge Runtime register()...')
      await edgeInstrumentation.register()
    }
  }

  // Load client instrumentation if we're on the client
  if (typeof window !== 'undefined') {
    console.log('[Main Instrumentation] Loading client instrumentation...')
    await import('./instrumentation-client')
  }
}
