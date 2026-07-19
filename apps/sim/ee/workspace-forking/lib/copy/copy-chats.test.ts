/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import { copyForkChatDeployments } from '@/ee/workspace-forking/lib/copy/copy-chats'

/**
 * Sequenced select mock: each `.select().from().where()` resolves the next queued result.
 * The chat copy issues (1) source chats, (2) target chat rows, then per identifier attempt
 * (3+) the taken-identifier check; inserts are captured.
 */
function makeTx(selectResults: unknown[][]) {
  const inserted: Array<Record<string, unknown>> = []
  let call = 0
  const tx = {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(selectResults[call++] ?? []) }),
    }),
    insert: () => ({
      values: (values: Array<Record<string, unknown>>) => {
        inserted.push(...values)
        return Promise.resolve()
      },
    }),
  }
  return { tx: tx as unknown as DbOrTx, inserted }
}

const sourceChat = (overrides: Record<string, unknown> = {}) => ({
  id: 'chat-src',
  workflowId: 'wf-src',
  userId: 'src-user',
  identifier: 'original-chat',
  title: 'Support Chat',
  description: 'desc',
  isActive: true,
  customizations: { welcomeMessage: 'hi' },
  authType: 'password',
  password: 'hashed-secret',
  allowedEmails: ['a@b.com'],
  outputConfigs: [{ blockId: 'block-src', path: 'content' }],
  archivedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
})

const pair = {
  sourceWorkflowId: 'wf-src',
  targetWorkflowId: 'wf-tgt',
  workflowName: 'Support Flow',
}

describe('copyForkChatDeployments', () => {
  it('copies a live source chat with a generated identifier and remapped output block ids', async () => {
    const { tx, inserted } = makeTx([
      [sourceChat()],
      [], // target has no chat rows
      [], // no identifier collisions
    ])
    const result = await copyForkChatDeployments({
      tx,
      pairs: [pair],
      targetWorkspaceName: 'My Team WS',
      userId: 'user-1',
      now: new Date('2026-07-07'),
      resolveBlockId: (targetWorkflowId, sourceBlockId) =>
        `${targetWorkflowId}:${sourceBlockId}:mapped`,
    })

    expect(result.created).toBe(1)
    expect(inserted).toHaveLength(1)
    const copy = inserted[0]
    expect(copy.id).not.toBe('chat-src')
    expect(copy.workflowId).toBe('wf-tgt')
    expect(copy.userId).toBe('user-1')
    // `{workspace}-{workflow}-{randomnum}` in the identifier charset.
    expect(copy.identifier).toMatch(/^my-team-ws-support-flow-\d{6}$/)
    // Config copies verbatim - auth (hashed password) included.
    expect(copy.title).toBe('Support Chat')
    expect(copy.authType).toBe('password')
    expect(copy.password).toBe('hashed-secret')
    expect(copy.allowedEmails).toEqual(['a@b.com'])
    // Output configs bind to the target's block ids via the sync's block resolver.
    expect(copy.outputConfigs).toEqual([{ blockId: 'wf-tgt:block-src:mapped', path: 'content' }])
    expect(copy.archivedAt).toBeNull()
  })

  it('leaves a target that already has ANY chat row untouched (live or archived - never resurrects)', async () => {
    const { tx, inserted } = makeTx([
      [sourceChat()],
      [{ workflowId: 'wf-tgt' }], // target already has a chat row
    ])
    const result = await copyForkChatDeployments({
      tx,
      pairs: [pair],
      targetWorkspaceName: 'WS',
      userId: 'user-1',
      now: new Date(),
      resolveBlockId: (_wf, blockId) => blockId,
    })
    expect(result.created).toBe(0)
    expect(inserted).toHaveLength(0)
  })

  it('never emits duplicate identifiers within a batch (same workspace + workflow slug)', async () => {
    const twoChats = makeTx([
      [sourceChat(), sourceChat({ id: 'chat-src-2', identifier: 'other' })],
      [], // target has no chat rows
      [], // no live-identifier collisions
    ])
    const result = await copyForkChatDeployments({
      tx: twoChats.tx,
      pairs: [pair],
      targetWorkspaceName: 'WS',
      userId: 'user-1',
      now: new Date(),
      resolveBlockId: (_wf, blockId) => blockId,
    })
    expect(result.created).toBe(2)
    const identifiers = twoChats.inserted.map((row) => row.identifier)
    expect(new Set(identifiers).size).toBe(2)
  })

  it('no-ops with no pairs or no live source chats', async () => {
    const empty = makeTx([[]])
    expect(
      (
        await copyForkChatDeployments({
          tx: empty.tx,
          pairs: [pair],
          targetWorkspaceName: 'WS',
          userId: 'user-1',
          now: new Date(),
          resolveBlockId: (_wf, blockId) => blockId,
        })
      ).created
    ).toBe(0)
    expect(
      (
        await copyForkChatDeployments({
          tx: empty.tx,
          pairs: [],
          targetWorkspaceName: 'WS',
          userId: 'user-1',
          now: new Date(),
          resolveBlockId: (_wf, blockId) => blockId,
        })
      ).created
    ).toBe(0)
  })
})
