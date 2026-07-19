#!/usr/bin/env bun

/**
 * Builds the immutable E2B image used for Full-stack App Vite builds.
 *
 * The image contains only the curated build toolchain and the Sim App SDK.
 * Runtime builds never run npm install or dependency lifecycle scripts.
 *
 * Usage:
 *   E2B_API_KEY=... bun run apps/sim/scripts/build-app-e2b-template.ts [--name <name>] [--no-cache]
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultBuildLogger, Template } from '@e2b/code-interpreter'

const DEFAULT_TEMPLATE_NAME = 'sim-app-build'
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const TEMPLATE_INPUTS = [
  'apps/sim/scripts/e2b-app-build/package.json',
  'apps/sim/scripts/e2b-app-build/collect-artifacts.mjs',
  'apps/sim/scripts/e2b-app-build/capture-thumbnail.mjs',
  'packages/app-sdk/src/index.ts',
] as const
const appSdkEntries = readdirSync(resolve(REPOSITORY_ROOT, 'packages/app-sdk/src'), {
  withFileTypes: true,
})
if (
  appSdkEntries.length !== 1 ||
  !appSdkEntries[0]?.isFile() ||
  appSdkEntries[0]?.name !== 'index.ts'
) {
  throw new Error(
    'The E2B template currently copies packages/app-sdk/src/index.ts only. Update TEMPLATE_INPUTS and copy rules before adding SDK source files.'
  )
}
const inputDigest = createHash('sha256')
for (const path of TEMPLATE_INPUTS) {
  inputDigest
    .update(path)
    .update('\0')
    .update(readFileSync(resolve(REPOSITORY_ROOT, path)))
    .update('\0')
}
const buildTag = `toolchain-${inputDigest.digest('hex').slice(0, 20)}`

const appBuildTemplate = Template({ fileContextPath: REPOSITORY_ROOT })
  .fromNodeImage('22')
  .setUser('root')
  .makeDir(['/opt/sim-app', '/opt/sim-app/vendor/app-sdk', '/home/user'])
  .copy('apps/sim/scripts/e2b-app-build/package.json', '/opt/sim-app/package.json')
  .copy(
    'apps/sim/scripts/e2b-app-build/collect-artifacts.mjs',
    '/opt/sim-app/collect-artifacts.mjs'
  )
  .copy(
    'apps/sim/scripts/e2b-app-build/capture-thumbnail.mjs',
    '/opt/sim-app/capture-thumbnail.mjs'
  )
  .copy('packages/app-sdk/src/index.ts', '/opt/sim-app/vendor/app-sdk/index.ts')
  .setWorkdir('/opt/sim-app')
  // Dependencies are fully curated above. No user package file reaches this layer.
  .npmInstall()
  .runCmd(
    'PLAYWRIGHT_BROWSERS_PATH=/opt/sim-app/ms-playwright npx playwright install --with-deps chromium'
  )
  .runCmd('npm cache clean --force')
  .setWorkdir('/home/user')
  .setUser('user')

async function main() {
  if (!process.env.E2B_API_KEY) {
    console.error('E2B_API_KEY is required')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const nameIdx = args.indexOf('--name')
  const templateName = nameIdx !== -1 ? args[nameIdx + 1] : DEFAULT_TEMPLATE_NAME
  const skipCache = args.includes('--no-cache')
  if (!templateName) {
    throw new Error('--name requires a value')
  }

  console.log(`Building App E2B template: ${templateName}`)
  console.log(skipCache ? 'Cache: disabled\n' : 'Cache: enabled\n')

  const result = await Template.build(appBuildTemplate, templateName, {
    onBuildLogs: defaultBuildLogger(),
    tags: [buildTag],
    ...(skipCache ? { skipCache: true } : {}),
  })

  const templateReference = `${result.name}:${buildTag}`
  const digest = `e2b-build:${result.buildId}`
  console.log(`\nDone. Immutable template ID: ${result.templateId}`)
  console.log('Set these values in the Sim environment:')
  console.log(`E2B_APP_BUILD_TEMPLATE_ID=${templateReference}`)
  console.log(`E2B_APP_BUILD_IMAGE_DIGEST=${digest}`)
}

main().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})
