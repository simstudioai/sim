import { additionalFiles, additionalPackages } from '@trigger.dev/build/extensions/core'
import { defineConfig } from '@trigger.dev/sdk'
import { env } from './lib/core/config/env'

export default defineConfig({
  project: env.TRIGGER_PROJECT_ID!,
  runtime: 'node-22',
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
    external: ['isolated-vm', 'pptxgenjs'],
    extensions: [
      additionalFiles({
        files: ['./lib/execution/isolated-vm-worker.cjs', './lib/execution/pptx-worker.cjs'],
      }),
      additionalPackages({
        packages: ['unpdf', 'pdf-lib', 'isolated-vm', 'pptxgenjs'],
      }),
    ],
  },
})
