#!/usr/bin/env bun
/** Checks committed styling against central design contracts. See design-conformance/README.md. */
try {
  const { main } = await import('#design-conformance/command')
  process.exitCode = await main()
} catch (error) {
  process.stderr.write(
    `Design check could not start: ${JSON.stringify(error instanceof Error ? error.message : 'Operational failure')}\n`
  )
  process.exitCode = 2
}
