import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { createClient } from 'redis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { FileDocStore } from '@/handlers/file-doc-store'

const redisUrl = process.env.REDIS_URL
if (!redisUrl) throw new Error('Integration setup must provide disposable Redis')
const redis = createClient({ url: redisUrl })
const store = new FileDocStore(redisUrl)
const rooms: { name: string; doc: Y.Doc }[] = []
const checks: { name: string; status: string; durationMs: number; error?: string }[] = []
const alice = { userId: 'fixture-alice', connectionId: 'socket-alice' }
const bob = { userId: 'fixture-bob', connectionId: 'socket-bob' }

beforeAll(async () => {
  await redis.connect()
  await store.init()
})

async function fixture() {
  const name = `project-file-doc:${generateId()}/${generateId()}`
  const doc = new Y.Doc()
  const generation = generateId()
  doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
  doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, generation)
  await store.seedIfEmpty(name, Y.encodeStateAsUpdate(doc), 1)
  await store.attachRoom(name, doc)
  rooms.push({ name, doc })
  return { name, doc, generation }
}

function update(doc: Y.Doc, value: string) {
  const before = Y.encodeStateVector(doc)
  doc.getText('body').insert(doc.getText('body').length, value)
  return Y.encodeStateAsUpdate(doc, before)
}

function check(name: string, run: () => Promise<void>) {
  it(name, async () => {
    const start = performance.now()
    try {
      await run()
      checks.push({ name, status: 'passed', durationMs: performance.now() - start })
    } catch (error) {
      checks.push({
        name,
        status: 'failed',
        durationMs: performance.now() - start,
        error: getErrorMessage(error),
      })
      throw error
    }
  })
}

describe('Project document editor attribution over real Redis', () => {
  check(
    'deduplication retains the accepted author and obsolete generations cannot append',
    async () => {
      const f = await fixture()
      const delta = update(f.doc, 'A')
      await store.publishClientUpdateAndWait(f.name, 'update-a', delta, f.generation, alice)
      await store.publishClientUpdateAndWait(f.name, 'update-a', delta, f.generation, bob)
      const state = await store.getStreamSnapshot(f.name, f.generation)
      expect(state?.editor).toEqual(alice)
      await expect(
        store.publishClientUpdateAndWait(f.name, 'old', delta, 'obsolete', bob)
      ).rejects.toThrow()
      expect((await store.getStreamSnapshot(f.name, f.generation))?.editor).toEqual(alice)
    }
  )

  check(
    'Project updates without an authenticated editor are rejected before acceptance',
    async () => {
      const f = await fixture()
      await expect(
        store.publishClientUpdateAndWait(f.name, 'unknown', update(f.doc, 'X'), f.generation)
      ).rejects.toThrow('Project document updates require an authenticated editor')
      expect(await redis.xLen(`filedoc:stream:${f.name}`)).toBe(1)
    }
  )

  check(
    'real compaction preserves the editor for a headless replica reconstructing accepted bytes',
    async () => {
      const f = await fixture()
      for (let index = 0; index < 447; index++) {
        await store.publishClientUpdateAndWait(
          f.name,
          `edit-${index}`,
          update(f.doc, 'x'),
          f.generation,
          index === 446 ? bob : alice
        )
        await store.catchUp(f.name)
      }
      store.publish(f.name, update(f.doc, 'x'), true)
      await expect
        .poll(async () =>
          (await redis.xRange(`filedoc:stream:${f.name}`, '-', '+')).some(
            (entry) => entry.message.c === '1'
          )
        )
        .toBe(true)
      store.detachRoom(f.name)
      const state = await store.getStreamSnapshot(f.name, f.generation)
      expect(state?.editor).toEqual(bob)
      const restored = new Y.Doc()
      try {
        if (!state) throw new Error('Missing reconstructed state')
        Y.applyUpdate(restored, state.docState)
        expect(restored.getText('body').toString()).toBe('x'.repeat(448))
      } finally {
        restored.destroy()
      }
    }
  )

  check(
    'retiring a generation fences old seeds and delayed retirement preserves the replacement',
    async () => {
      const f = await fixture()
      await store.publishClientUpdateAndWait(
        f.name,
        'before-archive',
        update(f.doc, 'old'),
        f.generation,
        alice
      )
      const replacement = new Y.Doc()
      const replacementId = generateId()
      replacement.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.flag, true)
      replacement.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, replacementId)
      try {
        expect(await store.retireDocumentGeneration(f.name, f.generation, replacementId)).toEqual({
          status: 'applied',
          docId: f.generation,
        })
        expect(await store.seedIfEmpty(f.name, Y.encodeStateAsUpdate(f.doc), 1, true)).toBe(false)
        await expect(
          store.publishClientUpdateAndWait(f.name, 'stale', update(f.doc, '!'), f.generation, alice)
        ).rejects.toThrow()
        expect(await store.seedIfEmpty(f.name, Y.encodeStateAsUpdate(replacement), 1, true)).toBe(
          true
        )
        await store.publishClientUpdateAndWait(
          f.name,
          'after-restore',
          update(replacement, 'new'),
          replacementId,
          bob
        )
        expect(await store.retireDocumentGeneration(f.name, f.generation, replacementId)).toEqual({
          status: 'stale',
        })
        const state = await store.getStreamSnapshot(f.name, replacementId)
        expect(state?.editor).toEqual(bob)
        const restored = new Y.Doc()
        try {
          if (!state) throw new Error('Replacement generation was lost')
          Y.applyUpdate(restored, state.docState)
          expect(restored.getText('body').toString()).toBe('new')
        } finally {
          restored.destroy()
        }
      } finally {
        replacement.destroy()
      }
    }
  )

  check(
    'a late prefix snapshot cannot replace a newer editor and unknown newer edits erase attribution',
    async () => {
      const f = await fixture()
      await store.publishClientUpdateAndWait(
        f.name,
        'alice',
        update(f.doc, 'A'),
        f.generation,
        alice
      )
      const prefix = Y.encodeStateAsUpdate(f.doc)
      const [entry] = await redis.xRevRange(`filedoc:stream:${f.name}`, '+', '-', { COUNT: 1 })
      if (!entry) throw new Error('Missing accepted prefix')
      await store.publishClientUpdateAndWait(f.name, 'bob', update(f.doc, 'B'), f.generation, bob)
      await redis.xAdd(`filedoc:stream:${f.name}`, '*', {
        u: Buffer.from(prefix).toString('base64'),
        s: '1',
        c: '1',
        g: f.generation,
        eu: alice.userId,
        ec: alice.connectionId,
        ei: entry.id,
      })
      expect((await store.getStreamSnapshot(f.name, f.generation))?.editor).toEqual(bob)
      await redis.xAdd(`filedoc:stream:${f.name}`, '*', {
        u: Buffer.from(update(f.doc, '?')).toString('base64'),
      })
      expect((await store.getStreamSnapshot(f.name, f.generation))?.editor).toBeNull()
    }
  )
})

afterAll(async () => {
  await store.shutdown()
  for (const { name, doc } of rooms) {
    const keys = await redis.keys(`filedoc:*:${name}`)
    if (keys.length) await redis.del(keys)
    doc.destroy()
  }
  await redis.quit()
  const reportPath =
    process.env.PROJECT_FILE_REDIS_REPORT_PATH ?? resolve('test-results/project-file-redis.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
})
