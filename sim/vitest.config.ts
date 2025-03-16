/// <reference types="vitest" />
import path from 'path'
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
    alias: {
      '@': path.resolve(__dirname),
      '@/lib': path.resolve(__dirname, './app/lib'),
      '@/stores': path.resolve(__dirname, './app/stores'),
      '@/components': path.resolve(__dirname, './app/components'),
      '@/app': path.resolve(__dirname, './app'),
      '@/api': path.resolve(__dirname, './app/api'),
      '@/executor': path.resolve(__dirname, './app/executor'),
      '@/providers': path.resolve(__dirname, './app/providers'),
      '@/tools': path.resolve(__dirname, './app/tools'),
      '@/blocks': path.resolve(__dirname, './app/blocks'),
      '@/serializer': path.resolve(__dirname, './app/serializer'),
    },
  },
})
