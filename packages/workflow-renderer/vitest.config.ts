import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    /* Node by default; the mount tests opt into jsdom with a `@vitest-environment`
       docblock, the same way the rest of the monorepo does. */
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
  },
})
