import { additionalPackages } from '@trigger.dev/build/extensions/core'
import { defineConfig } from '@trigger.dev/sdk'
import { env } from './lib/core/config/env'

export default defineConfig({
  project: env.TRIGGER_PROJECT_ID!,
  runtime: 'node',
  logLevel: 'log',
  maxDuration: 5400,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
    },
  },
  dirs: ['./background'],
  build: {
    extensions: [
      additionalPackages({
        packages: ['unpdf', 'pdf-lib'],
      }),
    ],
  },
})
