import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { toArray, toRecord } from '@sim/utils/object'
import { executeTool } from '@/tools'

/** Exercises the registered tools against Buffer using disposable draft posts. */
const logger = createLogger('BufferE2E')
const reportPath = process.env.BUFFER_E2E_REPORT_PATH
assert(reportPath, 'BUFFER_E2E_REPORT_PATH is required')
const apiKey =
  process.env.BUFFER_API_KEY ??
  (process.env.BUFFER_API_KEY_FILE
    ? (await readFile(process.env.BUFFER_API_KEY_FILE, 'utf8')).trim()
    : '')
assert(apiKey, 'BUFFER_API_KEY or BUFFER_API_KEY_FILE is required')
const fixtureId = generateId()
const checks: {
  name: string
  status: 'passed' | 'failed' | 'skipped'
  durationMs: number
  error?: string
}[] = []
const posts = new Set<string>()
let ideaId: string | undefined
let organizationId: string | undefined
let channelId: string | undefined
const startedAt = new Date().toISOString()

async function check<T>(name: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    const value = await run()
    checks.push({ name, status: 'passed', durationMs: performance.now() - start })
    logger.info(name, { status: 'passed' })
    return value
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: performance.now() - start,
      error: getErrorMessage(error),
    })
    throw error
  }
}

async function tool(id: string, params: Record<string, unknown> = {}) {
  const result = await executeTool(
    id,
    { apiKey, ...params },
    {
      signal: AbortSignal.timeout(60_000),
      operationContext: { userId: fixtureId, workflowId: fixtureId },
    }
  )
  assert(result.success, result.error ?? `${id} failed`)
  return toRecord(result.output)
}

function id(value: unknown): string {
  assert(typeof value === 'string' && value.length > 0, 'Expected a resource ID')
  return value
}

async function run() {
  const account = await check('Get Account with complete organization details', async () => {
    const account = toRecord((await tool('buffer_get_account')).account)
    id(account.id)
    assert('preferences' in account && 'connectedApps' in account && 'backupEmail' in account)
    return account
  })
  const organizations = toArray(account.organizations).map(toRecord)
  const organization = process.env.BUFFER_ORGANIZATION_ID
    ? organizations.find((entry) => entry.id === process.env.BUFFER_ORGANIZATION_ID)
    : (organizations.find((entry) => Number(entry.channelCount) > 0) ?? organizations[0])
  assert(organization, 'The account needs a Buffer organization')
  organizationId = id(organization.id)
  assert('limits' in organization && 'members' in organization)
  await check('Filter account organizations', async () => {
    const account = toRecord(
      (await tool('buffer_get_account', { organizationFilter: { organizationId } })).account
    )
    assert.equal(toArray(account.organizations).length, 1)
  })
  const groups = await check('Get Idea Groups', async () =>
    toArray((await tool('buffer_get_idea_groups', { organizationId })).ideaGroups).map(toRecord)
  )
  await check('Create Idea with structured content', async () => {
    const idea = toRecord(
      (
        await tool('buffer_create_idea', {
          organizationId,
          content: {
            title: `Sim E2E ${fixtureId}`,
            text: 'Disposable integration validation idea',
            aiAssisted: false,
            services: [],
            tags: [],
          },
          ...(groups[0] ? { groupId: groups[0].id } : {}),
        })
      ).idea
    )
    ideaId = id(idea.id)
    assert.equal(toRecord(idea.content).title, `Sim E2E ${fixtureId}`)
    assert('position' in idea && 'createdAt' in idea)
  })
  await check('Get Ideas with pagination and group/tag filters', async () => {
    const output = await tool('buffer_get_ideas', {
      organizationId,
      limit: 1,
      groupFilter: groups[0] ? { groups: [groups[0].id] } : { membership: 'ungrouped' },
      tagsFilter: { in: [], isEmpty: true },
    })
    const pageInfo = toRecord(output.pageInfo)
    assert('hasPreviousPage' in pageInfo && 'startCursor' in pageInfo)
    assert(toArray(output.ideas).length <= 1)
    if (pageInfo.hasNextPage) {
      const next = await tool('buffer_get_ideas', {
        organizationId,
        limit: 1,
        after: pageInfo.endCursor,
        groupFilter: groups[0] ? { groups: [groups[0].id] } : { membership: 'ungrouped' },
        tagsFilter: { in: [], isEmpty: true },
      })
      assert.notEqual(toRecord(toArray(next.ideas)[0]).id, toRecord(toArray(output.ideas)[0]).id)
    }
  })
  const channels = await check('Get Channels with filters and network metadata', async () => {
    const output = await tool('buffer_get_channels', {
      organizationId,
      filter: { isLocked: false },
    })
    return toArray(output.channels).map(toRecord)
  })
  const channel = process.env.BUFFER_CHANNEL_ID
    ? channels.find((entry) => entry.id === process.env.BUFFER_CHANNEL_ID)
    : channels.find((entry) => entry.isDisconnected === false)
  if (process.env.BUFFER_CHANNEL_ID)
    assert(channel, 'BUFFER_CHANNEL_ID must identify an unlocked channel in this organization')
  if (!channel) {
    await check('Get Posts from organization without channels', async () => {
      const output = await tool('buffer_get_posts', {
        organizationId,
        limit: 1,
        filter: { status: ['draft'] },
        sort: [{ field: 'createdAt', direction: 'desc' }],
      })
      assert.deepEqual(output.posts, [])
      assert('hasPreviousPage' in toRecord(output.pageInfo))
    })
    await check('Aggregate metrics for an empty channel selection', async () => {
      const end = new Date()
      const output = await tool('buffer_get_aggregated_post_metrics', {
        organizationId,
        channelIds: [],
        startDateTime: new Date(end.getTime() - 86400000).toISOString(),
        endDateTime: end.toISOString(),
      })
      assert(Array.isArray(toRecord(output.aggregatedPostMetrics).metrics))
    })
    await check('Daily posting limits for an empty selection', async () => {
      assert.deepEqual(
        (await tool('buffer_get_daily_posting_limits', { channelIds: [] })).limits,
        []
      )
    })
    await check('Invalid authentication is rejected', async () => {
      const result = await executeTool('buffer_get_account', { apiKey: 'invalid' })
      assert.equal(result.success, false)
      assert.equal(result.error, 'Access token is not valid')
    })
    checks.push({
      name: 'Get Channel and draft create/edit/get/delete require a connected, unlocked channel',
      status: 'skipped',
      durationMs: 0,
    })
    process.exitCode = 2
    return
  }
  assert(channel, 'A connected, unlocked channel is required for draft mutation checks')
  channelId = id(channel.id)
  await check('Get Channel with full settings', async () => {
    const fetched = toRecord((await tool('buffer_get_channel', { channelId })).channel)
    assert.equal(fetched.id, channelId)
    assert('postingSchedule' in fetched && 'allowedActions' in fetched && 'metadata' in fetched)
  })
  await check('Get Daily Posting Limits', async () => {
    const output = await tool('buffer_get_daily_posting_limits', {
      channelIds: [channelId],
      date: new Date().toISOString(),
    })
    const limit = toRecord(toArray(output.limits)[0])
    assert.equal(limit.channelId, channelId)
    assert('scheduled' in limit && 'sent' in limit && 'isAtLimit' in limit)
  })
  await check('Get Aggregated Post Metrics', async () => {
    const end = new Date()
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)
    const output = await tool('buffer_get_aggregated_post_metrics', {
      organizationId,
      channelIds: [channelId],
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      tags: { in: [], isEmpty: true },
    })
    const aggregate = toRecord(output.aggregatedPostMetrics)
    assert(Array.isArray(aggregate.metrics))
    assert('metricsUpdatedAt' in aggregate)
  })
  const dueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
  const post = await check('Create draft with scheduling and optional controls', async () => {
    const post = toRecord(
      (
        await tool('buffer_create_post', {
          channelId,
          text: `Sim E2E ${fixtureId}`,
          mode: 'customScheduled',
          schedulingType: 'automatic',
          dueAt,
          saveToDraft: true,
          aiAssisted: false,
          needsApproval: false,
          tagIds: [],
          source: 'Sim integration E2E',
        })
      ).post
    )
    posts.add(id(post.id))
    assert.equal(post.status, 'draft')
    assert(
      'metadata' in post &&
        'metrics' in post &&
        'tags' in post &&
        'notes' in post &&
        'channel' in post
    )
    return post
  })
  const postId = id(post.id)
  await check('Caption-only edit preserves scheduling and publishing method', async () => {
    const edited = toRecord(
      (await tool('buffer_edit_post', { postId, text: `Sim E2E ${fixtureId} edited` })).post
    )
    assert.equal(edited.text, `Sim E2E ${fixtureId} edited`)
    assert.equal(edited.dueAt, post.dueAt)
    assert.equal(edited.schedulingType, post.schedulingType)
    assert.equal(edited.status, 'draft')
  })
  await check('Get Post reflects persisted edits', async () => {
    const fetched = toRecord((await tool('buffer_get_post', { postId })).post)
    assert.equal(fetched.text, `Sim E2E ${fixtureId} edited`)
  })
  await check('Get Posts with compound filters and multiple sort keys', async () => {
    const output = await tool('buffer_get_posts', {
      organizationId,
      limit: 1,
      filter: { channelIds: [channelId], status: ['draft'], createdAt: { start: startedAt } },
      sort: [
        { field: 'createdAt', direction: 'desc' },
        { field: 'dueAt', direction: 'asc' },
      ],
    })
    assert.equal(toRecord(toArray(output.posts)[0]).id, postId)
    assert('hasPreviousPage' in toRecord(output.pageInfo))
    assert.equal(toArray(output.edges).length, toArray(output.posts).length)
  })
  await check('Edit accepts empty assets and tag arrays and retains draft', async () => {
    const edited = toRecord(
      (await tool('buffer_edit_post', { postId, assets: [], tagIds: [], saveToDraft: true })).post
    )
    assert.deepEqual(edited.assets, [])
    assert.equal(edited.status, 'draft')
  })
  await check('Delete disposable draft', async () => {
    const output = await tool('buffer_delete_post', { postId })
    assert.equal(output.deleted, true)
    assert.equal(output.id, postId)
    posts.delete(postId)
  })
  await check('Invalid authentication is rejected', async () => {
    const result = await executeTool('buffer_get_account', { apiKey: 'invalid' })
    assert.equal(result.success, false)
    assert.equal(result.error, 'Access token is not valid')
  })
  checks.push({
    name: 'Publishing and platform-specific media/approval inputs require suitable channels and are not exercised by this draft-only suite',
    status: 'skipped',
    durationMs: 0,
  })
}

try {
  await run()
} catch (error) {
  if (!checks.some((entry) => entry.status === 'failed'))
    checks.push({
      name: 'Suite setup',
      status: 'failed',
      durationMs: 0,
      error: getErrorMessage(error),
    })
  logger.error('Buffer E2E failed', { error: getErrorMessage(error) })
  process.exitCode = 1
} finally {
  for (const postId of posts) {
    await check(`Cleanup draft ${postId}`, () => tool('buffer_delete_post', { postId })).catch(
      () => {
        process.exitCode = 1
      }
    )
  }
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        startedAt,
        finishedAt: new Date().toISOString(),
        fixtureId,
        organizationId,
        channelId,
        status: process.exitCode === 2 ? 'incomplete' : process.exitCode ? 'failed' : 'passed',
        retainedIdeaId: ideaId,
        cleanupNote: ideaId
          ? 'Remove retainedIdeaId in Buffer’s Ideas interface; the stable API has no delete-idea operation.'
          : undefined,
        checks,
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  logger.info('Report saved', { reportPath, retainedIdeaId: ideaId })
}

process.exit(process.exitCode ?? 0)
