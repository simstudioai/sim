/**
 * OpenTelemetry Instrumentation Entry Point
 *
 * This is the main entry point for OpenTelemetry instrumentation.
 * It delegates to runtime-specific instrumentation modules.
 */
export async function register() {
  // Load Node.js-specific instrumentation
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const nodeInstrumentation = await import('./instrumentation-node')
    if (nodeInstrumentation.register) {
      await nodeInstrumentation.register()
    }
  }

  // Load Edge Runtime-specific instrumentation
  if (process.env.NEXT_RUNTIME === 'edge') {
    const edgeInstrumentation = await import('./instrumentation-edge')
    if (edgeInstrumentation.register) {
      await edgeInstrumentation.register()
    }
  }

  // Load client instrumentation if we're on the client
  if (typeof window !== 'undefined') {
    await import('./instrumentation-client')
  }
}
