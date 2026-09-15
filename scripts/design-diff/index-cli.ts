import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { GitReader } from '#design-diff/git'
import { Metrics, measured, measurements } from '#design-diff/metrics'
import { SourceTree } from '#design-diff/source'
import { INDEX_VERSION, IndexStore, indexIdentity } from '#design-diff/store'
import type { Config } from '#design-diff/types'

/** Warm reusable syntax and revision facts without extracting or executing the application. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      ref: { type: 'string' },
      'cache-dir': { type: 'string' },
      metrics: { type: 'string' },
      identity: { type: 'boolean' },
    },
    strict: true,
  })
  const config = JSON.parse(
    readFileSync(new URL('../../design-diff.config.json', import.meta.url), 'utf8')
  ) as Config
  if (values.identity) {
    process.stdout.write(`${indexIdentity(config)}\n`)
    return
  }
  if (!values.ref || !values['cache-dir'])
    throw new Error('Required: --ref revision --cache-dir directory')
  const metrics = new Metrics()
  await measurements.run(metrics, async () => {
    const reader = new GitReader(process.cwd())
    const commit = reader.compare(values.ref!, values.ref!).head
    const index = await IndexStore.open(values['cache-dir']!, config)
    try {
      const tree = new SourceTree(reader, commit, config, index)
      measured('graph', () => tree.buildGraph())
      tree.complete()
      if (!index.persistent) throw new Error('Index storage unavailable')
    } finally {
      index.close()
    }
    const result = {
      status: 'completed',
      commit,
      identity: index.identity,
      indexSchemaVersion: INDEX_VERSION,
      ...metrics.snapshot(),
    }
    if (values.metrics) writeFileSync(values.metrics, `${JSON.stringify(result, null, 2)}\n`)
    process.stdout.write(
      `${JSON.stringify({ status: result.status, commit, identity: index.identity })}\n`
    )
  })
}

await main().catch(() => {
  process.stderr.write(
    'Design index failed: check arguments, source history and resource limits.\n'
  )
  process.exitCode = 1
})
