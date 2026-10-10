/**
 * A deployment ships in at most one release, against the disposable TEST_DATABASE_URL database:
 * the workspace lock, the cross-release check, and concurrent publishes all run for real.
 */
import { db } from '@sim/db'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type ChangelogChangeInput,
  insertReleaseInTx,
  updateRelease,
} from '@/lib/changelog/repository'

const control = postgres(readTestDatabaseUrl(), { max: 2, onnotice: () => {} })
const userId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
let patch = 0

async function seedDeployment(version: number): Promise<string> {
  const id = generateId()
  await control`INSERT INTO workflow_deployment_version (id, workflow_id, version, state)
    VALUES (${id}, ${workflowId}, ${version}, ${control.json({})})`
  return id
}

/** Publishes a release; with `holdOpen`, signals `written` and waits before committing. */
async function publish(
  changes: ChangelogChangeInput[],
  holdOpen?: { written: () => void; commit: Promise<void> }
) {
  const bodyFileId = generateId()
  await control`INSERT INTO workspace_files (id, key, user_id, workspace_id, context, original_name, content_type, size_bytes)
    VALUES (${bodyFileId}, ${`workspace/${workspaceId}/${bodyFileId}`}, ${userId}, ${workspaceId}, 'changelog',
      ${`${bodyFileId}.md`}, 'text/markdown', 1)`
  patch += 1
  return db.transaction(async (tx) => {
    const row = await insertReleaseInTx(
      tx,
      {
        id: generateId(),
        workspaceId,
        title: 'Fixture',
        versionMajor: 1,
        versionMinor: 0,
        versionPatch: patch,
        bumpReason: 'fixture',
        bodyFileId,
      },
      changes
    )
    if (holdOpen) {
      holdOpen.written()
      await holdOpen.commit
    }
    return row
  })
}

/** Resolves once a session is blocked on this workspace's changelog lock. */
async function lockWaiterAppears(): Promise<void> {
  const key = `changelog_release:${workspaceId}`
  for (;;) {
    const waiting = await control`
      WITH k AS (SELECT hashtextextended(${key}, 0) AS h)
      SELECT 1 FROM pg_locks, k
      WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
        AND classid::bigint = ((k.h >> 32) & 4294967295)
        AND objid::bigint = (k.h & 4294967295)`
    if (waiting.length > 0) return
    await sleep(10)
  }
}

const change = (deploymentVersionId: string): ChangelogChangeInput => ({
  text: 'fixture change',
  workflowId,
  deploymentVersionId,
})

describe('A deployment ships in one release', () => {
  beforeAll(async () => {
    await control.begin(async (tx) => {
      await tx`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
        VALUES (${userId}, 'Changelog fixture', ${`${userId}@example.test`}, true, now(), now())`
      await tx`INSERT INTO project (id, name, owner_id)
        VALUES (${workspaceId}, 'Changelog project', ${userId})`
      await tx`INSERT INTO workspace (id, project_id, name, owner_id, billed_account_user_id)
        VALUES (${workspaceId}, ${workspaceId}, 'Changelog fixtures', ${userId}, ${userId})`
      await tx`INSERT INTO workflow (id, user_id, workspace_id, name, last_synced, created_at, updated_at)
        VALUES (${workflowId}, ${userId}, ${workspaceId}, 'Fixture workflow', now(), now(), now())`
    })
  })

  afterAll(async () => {
    try {
      await control.begin(async (tx) => {
        await tx`DELETE FROM changelog_release WHERE workspace_id = ${workspaceId}`
        await tx`DELETE FROM workspace WHERE id = ${workspaceId}`
        await tx`DELETE FROM project WHERE id = ${workspaceId} AND owner_id = ${userId}`
        await tx`DELETE FROM "user" WHERE id = ${userId}`
      })
    } finally {
      await control.end()
    }
  })

  it('rejects a second release claiming a released deployment', async () => {
    const deployment = await seedDeployment(1)
    await publish([change(deployment)])

    await expect(publish([change(deployment)])).rejects.toThrow(/Already released/)
  })

  it('lets exactly one of two concurrent publishes claim a deployment', async () => {
    const deployment = await seedDeployment(2)
    const written = createDeferred<void>()
    const commit = createDeferred<void>()

    const first = publish([change(deployment)], {
      written: () => written.resolve(),
      commit: commit.promise,
    })
    await written.promise
    const second = publish([change(deployment)])
    await Promise.race([second.catch(() => {}), lockWaiterAppears()])
    commit.resolve()

    await expect(first).resolves.toMatchObject({ workspaceId })
    await expect(second).rejects.toThrow(/Already released/)
    const claims =
      await control`SELECT 1 FROM changelog_change WHERE deployment_version_id = ${deployment}`
    expect(claims).toHaveLength(1)
  })

  it('lets a release keep its own deployment when its changes are replaced', async () => {
    const deployment = await seedDeployment(3)
    const release = await publish([change(deployment)])

    const updated = await updateRelease(release.id, release.revision, userId, {}, [
      { ...change(deployment), text: 'reworded change' },
    ])

    expect(updated?.changes.map((c) => c.text)).toEqual(['reworded change'])
  })
})
