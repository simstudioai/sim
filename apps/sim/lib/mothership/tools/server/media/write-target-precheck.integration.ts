/**
 * Real-Postgres proof that the paid media tools refuse a stale output path before they generate:
 * the folder-moved refusal used to fire only at write time, after the provider had billed, so
 * the model retried and paid again.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import { auditLog, organization, user, workspace, workspaceFiles } from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
const { mockGenerateContent, mockGenerateFalAudio, mockGenerateFalVideo } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
  mockGenerateFalAudio: vi.fn(),
  mockGenerateFalVideo: vi.fn(),
}))

vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class GoogleGenAI {
    models = { generateContent: mockGenerateContent }
  },
}))
vi.mock('@/lib/core/config/api-keys', () => ({ getRotatingApiKey: vi.fn(() => 'api-key') }))
vi.mock('@/lib/media/falai-audio', () => ({ generateFalAudio: mockGenerateFalAudio }))
vi.mock('@/lib/media/falai-video', () => ({ generateFalVideo: mockGenerateFalVideo }))

import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { observeServiceCosts } from '@/lib/mothership/billing/service-observer'
import type { ServerToolContext } from '@/lib/mothership/tools/server/base-tool'
import { generateImageServerTool } from '@/lib/mothership/tools/server/image/generate-image'
import { generateAudioServerTool } from '@/lib/mothership/tools/server/media/generate-audio'
import { generateVideoServerTool } from '@/lib/mothership/tools/server/media/generate-video'
import { createWorkspaceFileFolderAtPath } from '@/lib/uploads/contexts/workspace/file-folder-manager'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []

beforeAll(() => {
  fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-media-write-target-'))
})

afterAll(async () => {
  for (const ids of fixtures) {
    await db.delete(auditLog).where(eq(auditLog.workspaceId, ids.workspaceId))
    await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  }
  await rm(fixtureStorage.root, { recursive: true, force: true })
})

/** A fal generation that bills through `onCost` before returning, as the real client does. */
function billsThen(media: Record<string, unknown>) {
  return async ({ onCost }: { onCost: (cost: { costDollars: number }) => Promise<void> }) => {
    const cost = { costDollars: 0.1 }
    await onCost(cost)
    return { ...media, cost }
  }
}

beforeEach(() => {
  mockGenerateContent.mockReset().mockResolvedValue({
    candidates: [
      { content: { parts: [{ inlineData: { data: 'aW1hZ2U=', mimeType: 'image/png' } }] } },
    ],
  })
  mockGenerateFalAudio
    .mockReset()
    .mockImplementation(
      billsThen({ buffer: Buffer.from('audio'), contentType: 'audio/mpeg', model: 'tts' })
    )
  mockGenerateFalVideo
    .mockReset()
    .mockImplementation(
      billsThen({ buffer: Buffer.from('video'), contentType: 'video/mp4', model: 'veo' })
    )
})

/** A workspace whose `media` folder was moved under `archive`, so `files/media/…` is stale. */
async function seedMovedFolder() {
  const ids = createKnowledgeAclFixtureIds()
  fixtures.push(ids)
  await seedKnowledgeAclFixture(ids)
  await createWorkspaceFileFolderAtPath({
    workspaceId: ids.workspaceId,
    userId: ids.aliceId,
    path: '/archive',
  })
  const moved = await createWorkspaceFileFolderAtPath({
    workspaceId: ids.workspaceId,
    userId: ids.aliceId,
    path: '/archive/media',
  })
  const context: ServerToolContext = {
    userId: ids.aliceId,
    workspaceId: ids.workspaceId,
    toolCallId: 'tool-1',
    copilotToolExecution: true,
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([]),
  }
  return { ids, context, movedFolderId: moved.folder.id }
}

const tools = [
  {
    kind: 'audio',
    tool: generateAudioServerTool,
    provider: () => mockGenerateFalAudio,
    file: 'clip.mp3',
  },
  {
    kind: 'video',
    tool: generateVideoServerTool,
    provider: () => mockGenerateFalVideo,
    file: 'clip.mp4',
  },
  {
    kind: 'image',
    tool: generateImageServerTool,
    provider: () => mockGenerateContent,
    file: 'clip.png',
  },
] as const

describe('media generation output target precheck', () => {
  it.each(tools)(
    'refuses a moved-folder $kind target before generating or billing',
    async ({ tool, provider, file }) => {
      const { context } = await seedMovedFolder()
      const charges = vi.fn().mockResolvedValue(undefined)

      const result = await observeServiceCosts(charges, () =>
        tool.execute(
          { prompt: 'p', outputs: { files: [{ path: `files/media/${file}` }] } },
          context
        )
      )

      expect(result.success).toBe(false)
      expect(result.message).toContain('now lives at /archive/media')
      expect(provider()).not.toHaveBeenCalled()
      expect(charges).not.toHaveBeenCalled()
    }
  )

  it.each(tools)(
    'still generates and writes a $kind into the folder at its current path',
    async ({ tool, provider, file }) => {
      const { ids, context, movedFolderId } = await seedMovedFolder()

      const result = await tool.execute(
        { prompt: 'p', outputs: { files: [{ path: `files/archive/media/${file}` }] } },
        context
      )

      expect(result.success, result.message).toBe(true)
      expect(provider()).toHaveBeenCalledTimes(1)
      const written = await db
        .select({ name: workspaceFiles.originalName })
        .from(workspaceFiles)
        .where(
          and(
            eq(workspaceFiles.workspaceId, ids.workspaceId),
            eq(workspaceFiles.folderId, movedFolderId),
            isNull(workspaceFiles.deletedAt)
          )
        )
      expect(written).toEqual([{ name: file }])
    }
  )

  it('refuses a taken default video target before generating or billing', async () => {
    const { context } = await seedMovedFolder()
    const first = await generateVideoServerTool.execute({ prompt: 'p' }, context)
    expect(first.success, first.message).toBe(true)
    mockGenerateFalVideo.mockClear()
    const charges = vi.fn().mockResolvedValue(undefined)

    const second = await observeServiceCosts(charges, () =>
      generateVideoServerTool.execute({ prompt: 'p' }, context)
    )

    expect(second.success).toBe(false)
    expect(mockGenerateFalVideo).not.toHaveBeenCalled()
    expect(charges).not.toHaveBeenCalled()
  })
})
