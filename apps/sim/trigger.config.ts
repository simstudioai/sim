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
    external: ['isolated-vm'],
    extensions: [
      additionalFiles({
        files: [
          './lib/execution/isolated-vm-worker.cjs',
          './lib/execution/sandbox/bundles/pptxgenjs.cjs',
          './lib/execution/sandbox/bundles/docx.cjs',
          './lib/execution/sandbox/bundles/pdf-lib.cjs',
        ],
      }),
      additionalPackages({
        packages: ['unpdf', 'isolated-vm', 'react-dom', '@react-email/render'],
      }),
    ],
  },
})
