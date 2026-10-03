import { readFileSync } from 'node:fs'

/**
 * The published package version, and the `User-Agent` built from it.
 *
 * Its own module because both the command tree and the HTTP client need the
 * version, and the client cannot reach `program.ts` — `program` builds the
 * commands, which reach the client, so importing it back would close a cycle.
 *
 * Read from `package.json` rather than inlined so a release cannot ship a
 * version string that disagrees with the package it came from. The bundle keeps
 * `dist/index.js` one directory below the manifest, and npm always publishes the
 * manifest, so the relative path holds for an installed package as well as a
 * local build. Read LAZILY with a fallback: hosts that bundle this module into
 * a different layout (the sim server's embedded CLI, Trigger.dev workers) have
 * no manifest at the relative path, and an import-time throw took their whole
 * task graph down.
 */
function readPackageVersion(): string {
  try {
    const metadata: unknown = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    )
    if (
      typeof metadata === 'object' &&
      metadata !== null &&
      'version' in metadata &&
      typeof metadata.version === 'string'
    ) {
      return metadata.version
    }
  } catch {
    // Fall through to the sentinel: an embedded host has no manifest to read.
  }
  return '0.0.0-embedded'
}

let cachedVersion: string | null = null

export function cliVersion(): string {
  cachedVersion ??= readPackageVersion()
  return cachedVersion
}

/**
 * Identifies the CLI to the API, the way every other terminal client does.
 *
 * Without it a CLI request is indistinguishable from any other API traffic, so
 * a bug that only reproduces on one CLI version cannot be found in the server's
 * own logs. The runtime and platform ride along for the same reason: they are
 * the first things asked about a transport failure that only some users see.
 */
export function userAgent(): string {
  return `sim-cli/${cliVersion()} node/${process.versions.node} (${process.platform}; ${process.arch})`
}
