import path from 'node:path'

export const SIM_APP_DIR = path.resolve(process.cwd())
export const REPO_ROOT = path.resolve(SIM_APP_DIR, '../..')
export const DB_PACKAGE_DIR = path.join(REPO_ROOT, 'packages/db')
export const REALTIME_APP_DIR = path.join(REPO_ROOT, 'apps/realtime')
export const PLAYWRIGHT_CLI = path.join(REPO_ROOT, 'node_modules/@playwright/test/cli.js')

export function getRunDirectory(runId: string): string {
  return path.join(SIM_APP_DIR, 'e2e/.runs', runId)
}
