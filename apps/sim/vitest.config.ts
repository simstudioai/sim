import path from 'path'
/// <reference types="vitest" />
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

const nextEnv = require('@next/env')
const { loadEnvConfig } = nextEnv.default || nextEnv

export default defineConfig(({ mode }) => {
  const integration = mode === 'integration'
  if (!integration) loadEnvConfig(process.cwd())

  return {
    plugins: [react()],
    /**
     * Skip PostCSS entirely. Loading the Tailwind config for a `.module.css`
     * import costs ~150ms per test file that reaches an emcn component, and no
     * test reads real CSS.
     */
    css: { postcss: {} },
    test: {
      css: false,
      globals: true,
      environment: 'node',
      include: integration ? ['**/*.integration.ts'] : ['**/*.test.{ts,tsx}'],
      exclude: [...configDefaults.exclude, '**/node_modules/**', '**/dist/**'],
      setupFiles: integration
        ? ['./lib/knowledge/__integration__/setup.ts']
        : ['./vitest.setup.ts'],
      pool: 'threads',
      isolate: true,
      unstubEnvs: !integration,
      unstubGlobals: !integration,
      fileParallelism: !integration,
      maxConcurrency: 10,
      testTimeout: integration ? 30000 : 10000,
      hookTimeout: integration ? 30000 : 10000,
      /**
       * CI splits this suite across runners (`1/2`, `2/2`). A single Vite server
       * thread feeds every worker, so throughput stops scaling at ~4 workers on
       * one machine; more machines is the only parallelism left.
       */
      shard: integration ? undefined : process.env.SIM_TEST_SHARD || undefined,
    },
    resolve: {
      tsconfigPaths: true,
      alias: [
        {
          find: '@sim/db',
          replacement: path.resolve(__dirname, '../../packages/db'),
        },
        {
          find: '@sim/logger',
          replacement: path.resolve(__dirname, '../../packages/logger/src'),
        },
        {
          find: '@/stores/console/store',
          replacement: path.resolve(__dirname, 'stores/console/store.ts'),
        },
        {
          find: '@/stores/execution/store',
          replacement: path.resolve(__dirname, 'stores/execution/store.ts'),
        },
        {
          find: '@/blocks/types',
          replacement: path.resolve(__dirname, 'blocks/types.ts'),
        },
        {
          find: '@/serializer/types',
          replacement: path.resolve(__dirname, 'serializer/types.ts'),
        },
        { find: '@/lib', replacement: path.resolve(__dirname, 'lib') },
        { find: '@/stores', replacement: path.resolve(__dirname, 'stores') },
        {
          find: '@/components',
          replacement: path.resolve(__dirname, 'components'),
        },
        { find: '@/app', replacement: path.resolve(__dirname, 'app') },
        { find: '@/api', replacement: path.resolve(__dirname, 'app/api') },
        {
          find: '@/executor',
          replacement: path.resolve(__dirname, 'executor'),
        },
        {
          find: '@/providers',
          replacement: path.resolve(__dirname, 'providers'),
        },
        { find: '@/tools', replacement: path.resolve(__dirname, 'tools') },
        { find: '@/blocks', replacement: path.resolve(__dirname, 'blocks') },
        {
          find: '@/serializer',
          replacement: path.resolve(__dirname, 'serializer'),
        },
        { find: '@', replacement: path.resolve(__dirname) },
      ],
    },
  }
})
