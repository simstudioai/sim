#!/usr/bin/env bun
/**
 * Writes the application release a chart ships with into `helm/sim/Chart.yaml`
 * and regenerates the image inventory that derives from it.
 *
 * `appVersion` is what the chart's image tags default to, so a stale one
 * publishes a chart that silently installs an older Sim, and `helm/sim/images.yaml`
 * — the list an operator mirrors into a disconnected registry — names the wrong
 * tags with it. Because published chart versions are immutable, a stale value is
 * frozen the moment it ships.
 *
 * It was bumped by hand and drifted for forty releases, then twice more after a
 * check started catching it. The check could only refuse to publish; it could not
 * supply the value. The publish jobs run this instead, so the number is derived
 * from the release rather than remembered.
 *
 * Only node builtins are imported so this runs on a CI job with no dependencies
 * installed, matching `generate-image-manifest.ts`.
 *
 * @example
 * ```
 * bun run scripts/sync-chart-appversion.ts --version v0.8.26
 * bun run scripts/sync-chart-appversion.ts --version v0.8.26 --check
 * ```
 *
 * `--check` verifies both halves: that Chart.yaml names the version and that the
 * inventory generated from it is current.
 */
import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHART_PATH = resolve(ROOT, 'helm/sim/Chart.yaml')

/** A release tag as this repository cuts them: `v1.2.3`. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/

/** Matches the top-level `appVersion:` key, quoted or bare. */
const APP_VERSION_LINE = /^appVersion:.*$/m

function parseArgs(argv: string[]): { version: string; check: boolean } {
  const versionIndex = argv.indexOf('--version')
  const version = versionIndex === -1 ? '' : (argv[versionIndex + 1] ?? '')
  if (!RELEASE_TAG.test(version)) {
    throw new Error(
      `--version must be a release tag like v1.2.3, got ${version ? `"${version}"` : '<missing>'}`
    )
  }
  return { version, check: argv.includes('--check') }
}

async function main() {
  const { version, check } = parseArgs(process.argv.slice(2))

  const chart = await readFile(CHART_PATH, 'utf8')
  if (!APP_VERSION_LINE.test(chart)) {
    throw new Error(`No top-level appVersion key in ${CHART_PATH}`)
  }

  const next = chart.replace(APP_VERSION_LINE, `appVersion: "${version}"`)
  const changed = next !== chart

  if (check) {
    if (changed) {
      console.error(
        `helm/sim/Chart.yaml appVersion does not match ${version}. Run:\n` +
          `  bun run scripts/sync-chart-appversion.ts --version ${version}`
      )
      process.exit(1)
    }
    /**
     * The inventory derives from appVersion, so a matching Chart.yaml alone does
     * not mean the pair is consistent -- checking only half of what this script
     * writes would report success over a stale inventory.
     */
    const verified = spawnSync('bun', ['run', 'scripts/generate-image-manifest.ts', '--check'], {
      cwd: ROOT,
      stdio: 'inherit',
    })
    if (verified.status !== 0) process.exit(verified.status ?? 1)
    console.log(`appVersion is ${version} and the image inventory matches.`)
    return
  }

  if (changed) {
    await writeFile(CHART_PATH, next)
    console.log(`Set appVersion to ${version}.`)
  } else {
    console.log(`appVersion was already ${version}.`)
  }

  /**
   * The inventory embeds appVersion in every first-party image tag, so it has to
   * follow. Spawned rather than imported because the generator writes on import
   * of its own main and owns its formatting.
   */
  const generated = spawnSync('bun', ['run', 'scripts/generate-image-manifest.ts'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (generated.status !== 0) {
    throw new Error(`generate-image-manifest.ts exited with ${generated.status}`)
  }
}

if (import.meta.main) await main()
