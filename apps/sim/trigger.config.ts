import { defineConfig } from '@trigger.dev/sdk'
import { env } from './lib/env'

export default defineConfig({
  project: env.TRIGGER_PROJECT_ID!,
  runtime: 'node',
  logLevel: 'log',
  maxDuration: 600,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
    },
  },
  dirs: ['./background'],
})
