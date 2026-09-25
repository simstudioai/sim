import path from 'path'
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

const nextEnv = require('@next/env')
const { loadEnvConfig } = nextEnv.default || nextEnv

/**
 * Three modes over one alias/plugin setup:
 * - default: unit tests (`*.test.ts(x)`) with the global mocks in `vitest.setup.ts`.
 * - `--mode integration`: real-infrastructure suites (`*.integration.ts`) against the disposable
 *   PostgreSQL in `TEST_DATABASE_URL` (and Redis in `TEST_REDIS_URL`), run one file at a time, with
 *   a JSON report in `test-results/integration.json`.
 * - `--mode live`: opt-in `*.live.test.ts` acceptance runs against provider APIs, hosted sandboxes,
 *   local runtimes, or sibling checkouts that CI does not provision. Never collected otherwise.
 */
export default defineConfig(({ mode }) => {
  const integration = mode === 'integration'
  const live = mode === 'live'
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
      include: integration
        ? ['**/*.integration.ts']
        : live
          ? ['**/*.live.test.ts']
          : ['**/*.test.{ts,tsx}'],
      exclude: [
        ...configDefaults.exclude,
        '**/dist/**',
        ...(integration || live ? [] : ['**/*.live.test.ts']),
        /**
         * Quarantined: these suites already failed against a freshly provisioned database before
         * the integration layer was collected by glob (their fixtures predate connector and
         * credential changes). Fix and remove them from this list; never add a passing suite here.
         */
        ...(integration
          ? [
              'lib/credentials/__integration__/organization-personal-tokens.integration.ts',
              'lib/knowledge/__integration__/confluence-enrollment.integration.ts',
              'lib/knowledge/__integration__/excluded-member-documents.integration.ts',
              'lib/knowledge/__integration__/github-member.integration.ts',
              'lib/knowledge/__integration__/gmail-member.integration.ts',
              'lib/knowledge/__integration__/google-calendar-member.integration.ts',
              'lib/knowledge/__integration__/jira-member.integration.ts',
            ]
          : []),
      ],
      setupFiles: integration ? ['./vitest.integration.setup.ts'] : ['./vitest.setup.ts'],
      ...(integration && {
        reporters: ['default', 'json'],
        outputFile: { json: 'test-results/integration.json' },
      }),
      pool: 'threads',
      unstubEnvs: !integration,
      unstubGlobals: !integration,
      fileParallelism: !integration,
      maxConcurrency: 10,
      testTimeout: integration ? 30000 : 10000,
      hookTimeout: integration ? 30000 : 10000,
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
