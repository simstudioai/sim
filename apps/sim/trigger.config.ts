import { additionalPackages } from '@trigger.dev/build/extensions/core'
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
  build: {
    extensions: [
      // pdf-parse has native bindings, keep as external package
      additionalPackages({
        packages: ['pdf-parse'],
      }),
    ],
  },
})
