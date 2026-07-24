import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, parse } from 'node:path'

const PACKAGE_ENTRYPOINTS: Readonly<Record<string, string>> = {
  buffer: 'buffer/',
  process: 'process/browser',
}

export function readAppResolvedPackageVersion(packageName: string, appRoot: string): string {
  const requireFromApp = createRequire(join(appRoot, 'package.json'))
  const entrypoint = requireFromApp.resolve(PACKAGE_ENTRYPOINTS[packageName] ?? packageName)
  let directory = dirname(entrypoint)
  const filesystemRoot = parse(directory).root

  while (directory !== filesystemRoot) {
    const packageJsonPath = join(directory, 'package.json')
    if (existsSync(packageJsonPath)) {
      const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        name?: string
        version?: string
      }
      if (manifest.name === packageName && manifest.version) return manifest.version
    }
    directory = dirname(directory)
  }

  throw new Error(`Could not locate the package manifest resolved for ${packageName}`)
}
