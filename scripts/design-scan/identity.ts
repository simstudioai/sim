import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { contractsHash, registry } from '#design-conformance/contracts'
import { canonical, hash } from '#design-conformance/model'

const toolRoot = fileURLToPath(new URL('./', import.meta.url))
const analysisRoot = fileURLToPath(new URL('../design-conformance/', import.meta.url))

/** The full scan and diff check read the same maintained analyzer in this repository. */
export function scannerIdentity() {
  const files = [
    ...readdirSync(toolRoot)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => [toolRoot, name]),
    ...readdirSync(analysisRoot)
      .filter((name) => /\.(?:ts|json)$/.test(name))
      .map((name) => [analysisRoot, name]),
  ]
    .map(([directory, name]) => [
      path.relative(toolRoot, path.join(directory, name)),
      hash(readFileSync(path.join(directory, name))),
    ])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))

  return {
    version: 'design-scan/2',
    sourceHash: hash(canonical(files)),
    policy: registry.policy,
    contractsHash,
    bun: process.versions.bun ?? null,
  }
}

if (import.meta.main) process.stdout.write(`${JSON.stringify(scannerIdentity(), null, 2)}\n`)
