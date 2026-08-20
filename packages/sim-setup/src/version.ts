import { readFileSync } from 'node:fs'

function readPackageVersion(): string {
  const metadata: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  )
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    !('version' in metadata) ||
    typeof metadata.version !== 'string'
  ) {
    throw new Error('sim-setup package metadata is missing a valid version')
  }
  return metadata.version
}

/** The version in the manifest npm installs alongside the bundled executable. */
export const SETUP_VERSION = readPackageVersion()

/** Identifies setup traffic by package, runtime, platform, and architecture. */
export const SETUP_USER_AGENT = `sim-setup/${SETUP_VERSION} node/${process.versions.node} (${process.platform}; ${process.arch})`
