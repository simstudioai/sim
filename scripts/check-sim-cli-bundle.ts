#!/usr/bin/env bun
/**
 * Keeps two hand-kept lists in step with what the published `sim` CLI actually bundles. The
 * package builds with `--packages=bundle`, so every workspace package and npm dependency it
 * imports ships inside `dist/`:
 *
 * - `packages/sim-cli/THIRD_PARTY_LICENSES` names every npm package in the bundle and no other.
 *   The minified bundle drops their license banners, so this file is the notice their licenses
 *   require to ship with each copy.
 * - `.github/workflows/publish-sim-cli.yml` watches every workspace package in the bundle, so a
 *   change to one (a compiler fix in `@sim/workflow-code`, say) republishes the CLI that ships it.
 *
 * The bundle graph comes from the entry points the package's own `build` script names, bundled in
 * memory with a metafile; nothing is written. Fix a finding by editing the list it names: add a
 * newly bundled package's notice or trigger path, or drop one the bundle no longer holds.
 *
 * Run: `bun run check:sim-cli-bundle`
 */
import path from 'node:path'
import { compareStrings } from '@sim/utils/string'

const ROOT = path.resolve(import.meta.dir, '..')
const CLI_DIR = 'packages/sim-cli'
const LICENSES_FILE = `${CLI_DIR}/THIRD_PARTY_LICENSES`
const PUBLISH_WORKFLOW = '.github/workflows/publish-sim-cli.yml'

/** An npm package name, as each notice in {@link LICENSES_FILE} opens with one on its own line. */
const PACKAGE_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/
/** The package an input under `node_modules` belongs to, at its innermost `node_modules`. */
const NPM_PACKAGE = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\/(?!.*\/node_modules\/)/
/** A workspace package's source, outside any `node_modules`. */
const WORKSPACE_PACKAGE = /^packages\/([^/]+)\//
/** A trigger path watching a whole workspace package. */
const WATCHED_PACKAGE = /^packages\/([^/]+)\/\*\*$/

/** The entry points `packages/sim-cli`'s `build` script bundles. */
async function buildEntryPoints(): Promise<string[]> {
  const manifest = await Bun.file(path.join(ROOT, CLI_DIR, 'package.json')).json()
  const bundleStep = String(manifest.scripts.build).split('&&')[0]
  const entries = bundleStep
    .split(/\s+/)
    .filter((token) => token.startsWith('src/') && token.endsWith('.ts'))
  if (entries.length === 0) {
    throw new Error(`No entry points found in ${CLI_DIR}'s build script: ${bundleStep}`)
  }
  return entries.map((entry) => path.join(ROOT, CLI_DIR, entry))
}

/** Every source file the CLI bundle holds, relative to the repo root. */
async function bundledInputs(): Promise<string[]> {
  const result = await Bun.build({
    entrypoints: await buildEntryPoints(),
    target: 'node',
    format: 'esm',
    packages: 'bundle',
    metafile: true,
  })
  if (!result.success || !result.metafile) {
    throw new Error(`Bundling ${CLI_DIR} failed:\n${result.logs.join('\n')}`)
  }
  return Object.keys(result.metafile.inputs).map((input) =>
    path.relative(ROOT, path.resolve(process.cwd(), input))
  )
}

/** The package names {@link LICENSES_FILE} gives a notice for. */
async function noticedPackages(): Promise<Set<string>> {
  const lines = (await Bun.file(path.join(ROOT, LICENSES_FILE)).text()).split('\n')
  return new Set(
    lines.filter(
      (line, index) => index > 0 && lines[index - 1].trim() === '' && PACKAGE_NAME.test(line.trim())
    )
  )
}

/** The workspace packages {@link PUBLISH_WORKFLOW}'s push trigger watches. */
async function watchedPackages(): Promise<Set<string>> {
  const workflow = Bun.YAML.parse(await Bun.file(path.join(ROOT, PUBLISH_WORKFLOW)).text()) as {
    on?: { push?: { paths?: unknown } }
  }
  const paths = workflow.on?.push?.paths
  if (!Array.isArray(paths)) throw new Error(`${PUBLISH_WORKFLOW} has no on.push.paths list`)
  return new Set(paths.flatMap((entry) => WATCHED_PACKAGE.exec(String(entry))?.[1] ?? []))
}

/** One message per name in `names` that `known` lacks, in name order. */
function missingFrom(
  names: ReadonlySet<string>,
  known: ReadonlySet<string>,
  message: (name: string) => string
): string[] {
  return [...names]
    .filter((name) => !known.has(name))
    .sort(compareStrings)
    .map(message)
}

async function main(): Promise<void> {
  const inputs = await bundledInputs()
  const npmPackages = new Set(inputs.flatMap((input) => NPM_PACKAGE.exec(input)?.[1] ?? []))
  const workspacePackages = new Set(
    inputs.flatMap((input) =>
      input.includes('node_modules/') ? [] : (WORKSPACE_PACKAGE.exec(input)?.[1] ?? [])
    )
  )
  const [noticed, watched] = await Promise.all([noticedPackages(), watchedPackages()])

  const problems = [
    ...missingFrom(
      npmPackages,
      noticed,
      (name) => `${name} is bundled but has no notice in ${LICENSES_FILE}.`
    ),
    ...missingFrom(
      noticed,
      npmPackages,
      (name) => `${LICENSES_FILE} has a notice for ${name}, which the bundle no longer holds.`
    ),
    ...missingFrom(
      workspacePackages,
      watched,
      (name) =>
        `packages/${name} is bundled but ${PUBLISH_WORKFLOW} does not watch 'packages/${name}/**', so a change there never republishes the CLI.`
    ),
    ...missingFrom(
      watched,
      workspacePackages,
      (name) => `${PUBLISH_WORKFLOW} watches 'packages/${name}/**', which the bundle does not hold.`
    ),
  ]

  if (problems.length > 0) {
    console.error(`✗ the sim CLI bundle and its lists disagree:\n- ${problems.join('\n- ')}`)
    process.exit(1)
  }
  console.log(
    `✓ ${npmPackages.size} bundled npm packages have notices; ${workspacePackages.size} bundled workspace packages republish the CLI`
  )
}

if (import.meta.main) await main()
