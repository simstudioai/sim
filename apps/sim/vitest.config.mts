import path, { resolve } from 'path'
/// <reference types="vitest" />
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { configDefaults, defineConfig } from 'vitest/config'
import nextEnv from '@next/env'

const projectDir = process.cwd()
const { loadEnvConfig } = nextEnv as { loadEnvConfig: (dir: string) => void }
loadEnvConfig(projectDir)

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, '**/node_modules/**', '**/dist/**'],
    setupFiles: ['./vitest.setup.ts'],
    // Allow slower API route/unit tests that set up many mocks
    testTimeout: 15000,
    hookTimeout: 15000,
    alias: {
      '@sim/db': resolve(__dirname, '../../packages/db'),
    },
  },
  resolve: {
    alias: [
      {
        find: '@sim/db',
        replacement: path.resolve(__dirname, '../../packages/db'),
      },
      {
        find: '@/lib/logs/console/logger',
        replacement: path.resolve(__dirname, 'lib/logs/console/logger.ts'),
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
})
