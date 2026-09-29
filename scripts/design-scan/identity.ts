import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonical, hash } from '#design-conformance/shared/model'
import { contractsHash, registry } from '#design-conformance/system/contracts'

const toolRoot = fileURLToPath(new URL('./', import.meta.url))
const analysisRoot = fileURLToPath(new URL('../design-conformance/', import.meta.url))
const analysisFiles = (directory: string): [string, string][] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return analysisFiles(path.join(directory, entry.name))
    return /\.(?:ts|json)$/.test(entry.name) ? [[directory, entry.name]] : []
  })

/** The full scan and diff check read the same maintained analyzer in this repository. */
export function scannerIdentity() {
  const files = [
    ...readdirSync(toolRoot)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => [toolRoot, name]),
    ...analysisFiles(analysisRoot),
  ]
    .map(([directory, name]) => [
      path.relative(toolRoot, path.join(directory, name)),
      hash(readFileSync(path.join(directory, name))),
    ])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))

  return {
    version: 'design-scan/3',
    sourceHash: hash(canonical(files)),
    policy: registry.policy,
    contractsHash,
    bun: process.versions.bun ?? null,
  }
}

if (import.meta.main) process.stdout.write(`${JSON.stringify(scannerIdentity(), null, 2)}\n`)
