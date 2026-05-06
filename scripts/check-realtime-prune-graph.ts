#!/usr/bin/env bun
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { $ } from 'bun'

const MAX_PRUNED_PACKAGE_COUNT = 25

async function listPackages(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root)
    const result: string[] = []
    for (const entry of entries) {
      const full = path.join(root, entry)
      const s = await stat(full)
      if (s.isDirectory()) {
        result.push(entry)
      }
    }
    return result
  } catch {
    return []
  }
}

async function main() {
  const scratch = await mkdtemp(path.join(tmpdir(), 'sim-realtime-prune-'))
  try {
    console.log(`Pruning @sim/realtime into ${scratch}`)
    await $`bunx turbo prune @sim/realtime --docker --out-dir=${scratch}`.quiet()

    const apps = await listPackages(path.join(scratch, 'json', 'apps'))
    const packages = await listPackages(path.join(scratch, 'json', 'packages'))
    const total = apps.length + packages.length

    console.log(`Pruned apps (${apps.length}): ${apps.join(', ') || '(none)'}`)
    console.log(`Pruned packages (${packages.length}): ${packages.join(', ') || '(none)'}`)
    console.log(`Total pruned workspaces: ${total}`)

    if (total > MAX_PRUNED_PACKAGE_COUNT) {
      console.error(
        `\n❌ Pruned realtime dep graph has ${total} workspaces (limit: ${MAX_PRUNED_PACKAGE_COUNT}).`
      )
      console.error(
        'A new package was pulled into @sim/realtime. Ensure only pure, single-purpose packages are in its dep graph.'
      )
      process.exit(1)
    }

    const unexpectedApps = apps.filter((name) => name !== 'realtime')
    if (unexpectedApps.length > 0) {
      console.error(
        `\n❌ Pruned realtime tree pulled in unexpected apps/: ${unexpectedApps.join(', ')}`
      )
      process.exit(1)
    }

    console.log('\n✅ Realtime prune size within expected bounds')
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

void main().catch((error) => {
  console.error('Realtime prune check failed:', error)
  process.exit(1)
})
