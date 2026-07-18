/** Platform-owned paths — revision copies are ignored/overwritten. */
export const PLATFORM_OWNED_PATHS = new Set([
  'package.json',
  'package-lock.json',
  'bun.lock',
  'bun.lockb',
  'pnpm-lock.yaml',
  'yarn.lock',
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'postcss.config.js',
  'postcss.config.cjs',
  'postcss.config.mjs',
  'tailwind.config.js',
  'tailwind.config.ts',
  'tsconfig.json',
  'tsconfig.node.json',
  'index.html',
  'src/sim.generated.ts',
])

/**
 * Bare imports allowed from generated app source (local Vite only).
 * `scheduler` is a react-dom transitive — listed explicitly so ESM resolve hooks
 * can allow it; plugins remain guardrails, not the production sandbox boundary.
 */
export const CURATED_BARE_IMPORTS = new Set([
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom/client',
  'scheduler',
  '@sim/app-sdk',
])
