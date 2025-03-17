/// <reference types="vitest" />
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['**/*.test.{ts,tsx,js,jsx}'],
    exclude: ['node_modules', '.next', 'dist'],
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules', '.next', 'dist'],
    },
  },
  resolve: {
    alias: [
      {
        find: '@/lib/logs/console-logger',
        replacement: path.resolve(__dirname, 'app/lib/logs/console-logger.ts'),
      },
      {
        find: '@/stores/console/store',
        replacement: path.resolve(__dirname, 'app/stores/console/store.ts'),
      },
      {
        find: '@/stores/execution/store',
        replacement: path.resolve(__dirname, 'app/stores/execution/store.ts'),
      },
      { find: '@/blocks/types', replacement: path.resolve(__dirname, 'app/blocks/types.ts') },
      {
        find: '@/serializer/types',
        replacement: path.resolve(__dirname, 'app/serializer/types.ts'),
      },
      { find: '@/lib', replacement: path.resolve(__dirname, 'app/lib') },
      { find: '@/stores', replacement: path.resolve(__dirname, 'app/stores') },
      { find: '@/components', replacement: path.resolve(__dirname, 'app/components') },
      { find: '@/app', replacement: path.resolve(__dirname, 'app') },
      { find: '@/api', replacement: path.resolve(__dirname, 'app/api') },
      { find: '@/executor', replacement: path.resolve(__dirname, 'app/executor') },
      { find: '@/providers', replacement: path.resolve(__dirname, 'app/providers') },
      { find: '@/tools', replacement: path.resolve(__dirname, 'app/tools') },
      { find: '@/blocks', replacement: path.resolve(__dirname, 'app/blocks') },
      { find: '@/serializer', replacement: path.resolve(__dirname, 'app/serializer') },
      { find: '@', replacement: path.resolve(__dirname) },
    ],
  },
})
