import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { OUTBOX_HANDLER_GROUPS } from '@/lib/core/outbox/handlers'
import type { OutboxHandlerRegistry } from '@/lib/core/outbox/service'

const APP_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const HANDLER_MAP_EXPORT = /^export const (\w+OutboxHandlers)\b/gm
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'public'])

/** Every non-test source file under the app that exports a `<name>OutboxHandlers` map. */
function findHandlerMapExports(): { file: string; exportName: string }[] {
  const found: { file: string; exportName: string }[] = []
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) continue
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!/\.tsx?$/.test(entry.name) || /\.(test|integration)\.tsx?$/.test(entry.name)) continue
      for (const [, exportName] of readFileSync(fullPath, 'utf8').matchAll(HANDLER_MAP_EXPORT)) {
        found.push({ file: fullPath, exportName })
      }
    }
  }
  walk(APP_ROOT)
  return found
}

describe('OUTBOX_HANDLER_GROUPS', () => {
  it('routes every event type to a single handler module', () => {
    const eventTypes = OUTBOX_HANDLER_GROUPS.flatMap((group) => group.events)
    expect(new Set(eventTypes).size).toBe(eventTypes.length)
  })

  it.each(OUTBOX_HANDLER_GROUPS.map((group) => [group.events.join(', '), group] as const))(
    'declares exactly the event types its module handles: %s',
    async (_name, group) => {
      const handlers = await group.load()
      expect(Object.keys(handlers).sort()).toEqual([...group.events].sort())
    },
    60_000
  )

  it('declares every event type of every exported handler map', async () => {
    const handlerMaps = findHandlerMapExports()
    expect(handlerMaps.length).toBeGreaterThan(0)

    const declared = new Set(OUTBOX_HANDLER_GROUPS.flatMap((group) => group.events))
    const undeclared: string[] = []
    for (const { file, exportName } of handlerMaps) {
      const module: Record<string, unknown> = await import(file)
      const handlers = module[exportName] as OutboxHandlerRegistry
      for (const eventType of Object.keys(handlers)) {
        if (!declared.has(eventType)) {
          undeclared.push(`${path.relative(APP_ROOT, file)}#${exportName}: ${eventType}`)
        }
      }
    }
    expect(undeclared).toEqual([])
  }, 60_000)
})
