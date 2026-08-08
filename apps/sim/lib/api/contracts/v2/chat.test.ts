import { describe, expect, it } from 'vitest'
import {
  MAX_V2_CHAT_ATTACHMENTS,
  MAX_V2_CHAT_CONTEXTS,
  MAX_V2_CHAT_PROMPT_LENGTH,
  v2ChatBodySchema,
} from '@/lib/api/contracts/v2/chat'

describe('v2ChatBodySchema', () => {
  it('enforces the prompt limit in UTF-8 bytes', () => {
    const overLimit = 'é'.repeat(MAX_V2_CHAT_PROMPT_LENGTH / 2 + 1)

    const result = v2ChatBodySchema.safeParse({
      workspaceId: 'workspace-1',
      prompt: overLimit,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Prompt cannot exceed 10 MiB')
    }
  })

  it('accepts an opaque continuation token and inline base64 attachment', () => {
    expect(
      v2ChatBodySchema.parse({
        workspaceId: 'workspace-1',
        prompt: 'Read this',
        continuationToken: 'opaque-token',
        attachments: [{ name: 'Notes.MD', mediaType: 'TEXT/MARKDOWN', data: 'aGk=' }],
      })
    ).toEqual({
      workspaceId: 'workspace-1',
      prompt: 'Read this',
      continuationToken: 'opaque-token',
      readOnly: false,
      attachments: [{ name: 'Notes.MD', mediaType: 'text/markdown', data: 'aGk=' }],
    })
  })

  it('accepts only the identity-bearing contexts supported by public resource lists', () => {
    const contexts = [
      { kind: 'workflow', workflowId: 'workflow-1', label: 'Release' },
      { kind: 'table', tableId: 'table-1', label: 'Leads' },
      { kind: 'file', fileId: 'file-1', label: 'Brief.md' },
      { kind: 'knowledge', knowledgeId: 'kb-1', label: 'Handbook' },
      { kind: 'logs', executionId: 'execution-1', label: 'Release log' },
      { kind: 'skill', skillId: 'skill-1', label: 'review' },
      { kind: 'mcp', serverId: 'mcp-1', label: 'Docs' },
    ]

    expect(
      v2ChatBodySchema.parse({ workspaceId: 'workspace-1', prompt: 'Use these', contexts }).contexts
    ).toEqual(contexts)
    expect(
      v2ChatBodySchema.safeParse({
        workspaceId: 'workspace-1',
        prompt: 'Use this',
        contexts: [{ kind: 'folder', folderId: 'folder-1', label: 'Folder' }],
      }).success
    ).toBe(false)
    expect(
      v2ChatBodySchema.safeParse({
        workspaceId: 'workspace-1',
        prompt: 'Use these',
        contexts: Array.from({ length: MAX_V2_CHAT_CONTEXTS + 1 }, (_, index) => ({
          kind: 'skill',
          skillId: `skill-${index}`,
          label: `skill-${index}`,
        })),
      }).success
    ).toBe(false)
  })

  it('allows an attachment-only turn but still rejects an entirely empty turn', () => {
    expect(
      v2ChatBodySchema.safeParse({
        workspaceId: 'workspace-1',
        prompt: '   ',
        attachments: [{ name: 'image.png', mediaType: 'image/png', data: 'AAAA' }],
      }).success
    ).toBe(true)
    expect(v2ChatBodySchema.safeParse({ workspaceId: 'workspace-1', prompt: '   ' }).success).toBe(
      false
    )
  })

  it('accepts only file basenames and a bounded attachment count', () => {
    for (const name of ['/tmp/secret.txt', '../secret.txt', 'folder\\secret.txt', 'bad\0.txt']) {
      expect(
        v2ChatBodySchema.safeParse({
          workspaceId: 'workspace-1',
          prompt: 'Read this',
          attachments: [{ name, mediaType: 'text/plain', data: 'aGk=' }],
        }).success
      ).toBe(false)
    }

    expect(
      v2ChatBodySchema.safeParse({
        workspaceId: 'workspace-1',
        prompt: 'Read these',
        attachments: Array.from({ length: MAX_V2_CHAT_ATTACHMENTS + 1 }, (_, index) => ({
          name: `${index}.txt`,
          mediaType: 'text/plain',
          data: 'aGk=',
        })),
      }).success
    ).toBe(false)
  })

  it('continues to reject raw caller-controlled chat ids and attachment URLs or paths', () => {
    for (const extra of [
      { chatId: 'raw-chat-id' },
      { conversationId: 'raw-chat-id' },
      {
        attachments: [
          {
            name: 'notes.txt',
            mediaType: 'text/plain',
            data: 'aGk=',
            path: '/tmp/notes.txt',
          },
        ],
      },
      {
        attachments: [
          {
            name: 'notes.txt',
            mediaType: 'text/plain',
            data: 'aGk=',
            url: 'https://example.com/notes.txt',
          },
        ],
      },
    ]) {
      expect(
        v2ChatBodySchema.safeParse({
          workspaceId: 'workspace-1',
          prompt: 'hello',
          ...extra,
        }).success
      ).toBe(false)
    }
  })
})
