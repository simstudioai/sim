/**
 * OpenTelemetry Instrumentation Entry Point
 *
 * This is the main entry point for OpenTelemetry instrumentation.
 * It delegates to runtime-specific instrumentation modules.
 */

/**
 * `env.ts` runs `createEnv` with `skipValidation`, so its `min(32)` declarations never
 * reject anything — this is the app's only gate on a secret that is present but fake.
 */
async function assertSecretsAreReal() {
  const { assertUsableSecrets, SECRET_ENV_KEYS } = await import('@sim/security/secrets')
  assertUsableSecrets(Object.fromEntries(SECRET_ENV_KEYS.map((key) => [key, process.env[key]])))
}

export async function register() {
  // Load Node.js-specific instrumentation
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await assertSecretsAreReal()

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
