/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { addFollowupTool, addFollowupV2Tool } from '@/tools/cursor/add_followup'
import { launchAgentTool, launchAgentV2Tool } from '@/tools/cursor/launch_agent'
import { flintGeneratePagesTool } from '@/tools/flint/generate_pages'
import { mem0AddMemoriesTool } from '@/tools/mem0/add_memories'
import { searchTextTool } from '@/tools/pinecone/search_text'
import type { PineconeUpsertTextRecord } from '@/tools/pinecone/types'
import { upsertTextTool } from '@/tools/pinecone/upsert_text'
import { prepareToolRequest } from '@/tools/request-transport'
import { zepAddMessagesTool } from '@/tools/zep/add_messages'

describe('nested model-input adapters', () => {
  it.each([
    [launchAgentTool, 'promptText', 'Launch'],
    [addFollowupTool, 'followupPromptText', 'Continue'],
  ] as const)(
    '$id omits the optional image key when no images were supplied',
    (tool, key, text) => {
      const modelInput = tool.request.modelInput
      if (modelInput?.mode !== 'project') {
        throw new Error('Expected Cursor prompt projection')
      }

      expect(modelInput.select({ [key]: text })).toStrictEqual({ [key]: text })
    }
  )

  it.each([
    ['array', false],
    ['JSON string', true],
  ] as const)(
    'projects only Mem0 message content and preserves the %s transport shape',
    (_label, stringify) => {
      const modelInput = mem0AddMemoriesTool.request.modelInput
      if (modelInput?.mode !== 'project' || !modelInput.applyProjected) {
        throw new Error('Expected Mem0 messages to define a nested projector')
      }

      const messages = [
        { role: 'user' as const, content: 'quote" slash\\ newline\n123 true' },
        { role: 'assistant' as const, content: 'second' },
      ]
      const input = stringify ? JSON.stringify(messages) : messages

      expect(modelInput.select({ messages: input, userId: 'user-1', apiKey: 'key' })).toStrictEqual(
        {
          messages: ['quote" slash\\ newline\n123 true', 'second'],
        }
      )

      const patch = modelInput.applyProjected(
        { messages: input },
        { messages: ['{{MEM0_SECRET}}', 'second'] }
      )
      expect(typeof patch.messages === 'string').toBe(stringify)
      const rebuilt =
        typeof patch.messages === 'string' ? JSON.parse(patch.messages) : patch.messages
      expect(rebuilt).toStrictEqual([
        { role: 'user', content: '{{MEM0_SECRET}}' },
        { role: 'assistant', content: 'second' },
      ])
    }
  )

  it.each([launchAgentTool, launchAgentV2Tool])(
    '$id selects effective image payloads without changing their serialized transport',
    (tool) => {
      const modelInput = tool.request.modelInput
      if (modelInput?.mode !== 'project') {
        throw new Error('Expected Cursor prompt projection')
      }
      const promptImages = JSON.stringify([
        {
          data: 'quote" slash\\ newline\n123 true',
          dimension: { width: 100, height: 200 },
        },
      ])

      expect(
        modelInput.select({
          apiKey: 'key',
          repository: 'https://github.com/acme/repo',
          promptText: 'Inspect this image',
          promptImages,
        })
      ).toStrictEqual({
        promptText: 'Inspect this image',
        promptImages: [
          {
            data: 'quote" slash\\ newline\n123 true',
            dimension: { width: 100, height: 200 },
          },
        ],
      })

      const body = tool.request.body?.({
        apiKey: 'key',
        repository: 'https://github.com/acme/repo',
        promptText: 'Inspect this image',
        promptImages,
      })
      expect((body as { prompt: { images: unknown } }).prompt.images).toStrictEqual([
        {
          data: 'quote" slash\\ newline\n123 true',
          dimension: { width: 100, height: 200 },
        },
      ])
    }
  )

  it.each([addFollowupTool, addFollowupV2Tool])(
    '$id preserves the existing empty-array fallback for malformed image JSON',
    (tool) => {
      const modelInput = tool.request.modelInput
      if (modelInput?.mode !== 'project') {
        throw new Error('Expected Cursor prompt projection')
      }

      expect(
        modelInput.select({
          apiKey: 'key',
          agentId: 'agent-1',
          followupPromptText: 'Continue',
          promptImages: 'not-json',
        })
      ).toStrictEqual({ followupPromptText: 'Continue' })

      const body = tool.request.body?.({
        apiKey: 'key',
        agentId: 'agent-1',
        followupPromptText: 'Continue',
        promptImages: 'not-json',
      })
      expect((body as { prompt: { images: unknown } }).prompt.images).toStrictEqual([])
    }
  )

  it('rejects an exact resolved secret inside serialized Cursor image data', () => {
    const secret = 'nested-image-secret'
    const promptImages = JSON.stringify([
      { data: `prefix-${secret}-suffix`, dimension: { width: 100, height: 200 } },
    ])
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'CURSOR_IMAGE', plaintext: secret, encryptedValue: 'encrypted-cursor-image' },
    ])
    registry.recordResolvedAtInputPath('CURSOR_IMAGE', secret, ['promptImages'])
    registry.recordResolvedInputProjection(
      ['promptImages'],
      promptImages,
      JSON.stringify([
        { data: 'prefix-{{CURSOR_IMAGE}}-suffix', dimension: { width: 100, height: 200 } },
      ])
    )

    expect(() =>
      prepareToolRequest(
        launchAgentTool,
        {
          apiKey: 'cursor-key',
          repository: 'https://github.com/acme/repo',
          promptText: 'Inspect this image',
          promptImages,
        },
        registry
      )
    ).toThrow('Model input could not be safely projected')
  })

  it('rejects a whole-value Cursor image secret instead of silently sending an empty array', () => {
    const promptImages = JSON.stringify([
      { data: 'whole-image-secret', dimension: { width: 100, height: 200 } },
    ])
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'CURSOR_IMAGES',
        plaintext: promptImages,
        encryptedValue: 'encrypted-cursor-images',
      },
    ])
    registry.recordResolvedAtInputPath('CURSOR_IMAGES', promptImages, ['promptImages'])
    registry.recordResolvedInputProjection(['promptImages'], promptImages, '{{CURSOR_IMAGES}}')

    expect(() =>
      prepareToolRequest(
        launchAgentTool,
        {
          apiKey: 'cursor-key',
          repository: 'https://github.com/acme/repo',
          promptText: 'Inspect this image',
          promptImages,
        },
        registry
      )
    ).toThrow('Model input could not be safely projected')
  })

  it('projects Cursor prompt text while preserving ordinary serialized image bytes exactly', () => {
    const promptImages = JSON.stringify([
      { data: 'ordinary-base64-bytes', dimension: { width: 100, height: 200 } },
    ])
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'CURSOR_PROMPT', plaintext: 'private-prompt', encryptedValue: 'encrypted-prompt' },
      { name: 'UNUSED_LOW_ENTROPY', plaintext: 'a', encryptedValue: 'encrypted-unused' },
    ])
    registry.recordResolvedAtInputPath('CURSOR_PROMPT', 'private-prompt', ['promptText'])
    registry.recordResolvedInputProjection(
      ['promptText'],
      'Inspect private-prompt',
      'Inspect {{CURSOR_PROMPT}}'
    )

    const request = prepareToolRequest(
      launchAgentTool,
      {
        apiKey: 'cursor-key',
        repository: 'https://github.com/acme/repo',
        promptText: 'Inspect private-prompt',
        promptImages,
      },
      registry
    )
    const body = JSON.parse(request.body ?? '{}')

    expect(body.prompt).toStrictEqual({
      text: 'Inspect {{CURSOR_PROMPT}}',
      images: [{ data: 'ordinary-base64-bytes', dimension: { width: 100, height: 200 } }],
    })
  })

  it.each([
    ['array', false],
    ['JSON string', true],
  ] as const)(
    'projects only Zep message content and preserves the %s transport shape',
    (_label, stringify) => {
      const modelInput = zepAddMessagesTool.request.modelInput
      if (modelInput?.mode !== 'project' || !modelInput.applyProjected) {
        throw new Error('Expected Zep messages to define a nested projector')
      }

      const messages = [
        {
          role: 'user',
          content: 'quote" slash\\ newline\n123 true',
          name: 'Ada',
          metadata: { source: 'ordinary metadata' },
        },
        { role: 'assistant', content: 'second', extra: true },
      ]
      const input = stringify ? JSON.stringify(messages) : messages

      expect(
        modelInput.select({ messages: input, threadId: 'thread-1', apiKey: 'key' })
      ).toStrictEqual({
        messages: ['quote" slash\\ newline\n123 true', 'second'],
      })

      const patch = modelInput.applyProjected(
        { messages: input },
        { messages: ['{{ZEP_SECRET}}', 'second'] }
      )
      expect(typeof patch.messages === 'string').toBe(stringify)
      const rebuilt =
        typeof patch.messages === 'string' ? JSON.parse(patch.messages) : patch.messages
      expect(rebuilt).toStrictEqual([
        {
          role: 'user',
          content: '{{ZEP_SECRET}}',
          name: 'Ada',
          metadata: { source: 'ordinary metadata' },
        },
        { role: 'assistant', content: 'second', extra: true },
      ])

      const body = zepAddMessagesTool.request.body?.({
        messages: patch.messages as string | Record<string, unknown>[],
        threadId: 'thread-1',
        apiKey: 'key',
      })
      expect(body).toStrictEqual({ messages: rebuilt })
    }
  )

  it('projects Pinecone chunk text without changing IDs, metadata, or array shape', () => {
    const modelInput = upsertTextTool.request.modelInput
    expect(modelInput?.mode).toBe('project')
    if (modelInput?.mode !== 'project' || !modelInput.applyProjected) {
      throw new Error('Expected Pinecone upsert to define a nested projector')
    }
    const records: PineconeUpsertTextRecord[] = [
      {
        _id: 'record-1',
        chunk_text: 'quote" slash\\ newline\n123 true',
        category: 'quote" slash\\ newline\n123 true',
        metadata: { source: 'quote" slash\\ newline\n123 true' },
      },
    ]
    const projectedSelection = { records: ['{{PINECONE_SECRET}}'] }

    expect(
      modelInput.select({ records, indexHost: 'host', namespace: 'ns', apiKey: 'key' })
    ).toStrictEqual({
      records: ['quote" slash\\ newline\n123 true'],
    })
    expect(modelInput.applyProjected({ records }, projectedSelection)).toStrictEqual({
      records: [
        {
          _id: 'record-1',
          chunk_text: '{{PINECONE_SECRET}}',
          category: 'quote" slash\\ newline\n123 true',
          metadata: { source: 'quote" slash\\ newline\n123 true' },
        },
      ],
    })
    expect(records[0].chunk_text).toBe('quote" slash\\ newline\n123 true')
  })

  it.each([
    ['object', false],
    ['JSON string', true],
  ] as const)(
    'projects only Pinecone rerank query text and preserves %s controls',
    (_label, stringify) => {
      const modelInput = searchTextTool.request.modelInput
      if (modelInput?.mode !== 'project' || !modelInput.applyProjected) {
        throw new Error('Expected Pinecone search rerank to define a nested projector')
      }
      const rerank = {
        model: 'bge-reranker-v2-m3',
        rank_fields: ['chunk_text'],
        top_n: 3,
        parameters: { truncate: 'END' },
        query: { text: 'rerank this' },
      }
      const input = stringify ? JSON.stringify(rerank) : rerank

      expect(modelInput.select({ searchQuery: 'search this', rerank: input })).toStrictEqual({
        searchQuery: 'search this',
        rerank: { query: { text: 'rerank this' } },
      })
      const patch = modelInput.applyProjected(
        { searchQuery: 'search this', rerank: input },
        {
          searchQuery: '{{SEARCH_QUERY}}',
          rerank: { query: { text: '{{RERANK_QUERY}}' } },
        }
      )
      expect(typeof patch.rerank === 'string').toBe(stringify)
      const rebuilt = typeof patch.rerank === 'string' ? JSON.parse(patch.rerank) : patch.rerank
      expect(rebuilt).toStrictEqual({
        ...rerank,
        query: { text: '{{RERANK_QUERY}}' },
      })
    }
  )

  it('uses the projected search query for implicit Pinecone reranking', () => {
    const modelInput = searchTextTool.request.modelInput
    if (modelInput?.mode !== 'project' || !modelInput.applyProjected) {
      throw new Error('Expected Pinecone search rerank to define a nested projector')
    }
    const rerank = { model: 'bge-reranker-v2-m3', rank_fields: ['chunk_text'] }
    expect(modelInput.select({ searchQuery: 'search this', rerank })).toStrictEqual({
      searchQuery: 'search this',
    })
    const patch = modelInput.applyProjected(
      { searchQuery: 'search this' },
      { searchQuery: '{{SEARCH_QUERY}}' }
    )
    const body = searchTextTool.request.body?.({
      indexHost: 'https://index.example.com',
      namespace: 'docs',
      apiKey: 'key',
      rerank,
      searchQuery: patch.searchQuery as string,
    }) as { rerank: { query: { text: string } } }
    expect(body.rerank.query.text).toBe('{{SEARCH_QUERY}}')
  })

  it('preserves Pinecone singleton and legacy NDJSON input forms', () => {
    const modelInput = upsertTextTool.request.modelInput
    if (modelInput?.mode !== 'project' || !modelInput.applyProjected) {
      throw new Error('Expected Pinecone upsert to define a nested projector')
    }
    const singleton: PineconeUpsertTextRecord = { _id: 'one', chunk_text: 'true' }
    expect(
      modelInput.applyProjected({ records: singleton }, { records: ['{{TRUE_SECRET}}'] })
    ).toStrictEqual({ records: { _id: 'one', chunk_text: '{{TRUE_SECRET}}' } })

    const ndjson = [
      JSON.stringify({ _id: 'one', chunk_text: '123', category: '123' }),
      JSON.stringify({ _id: 'two', chunk_text: 'true', category: 'true' }),
    ].join('\n')
    const patch = modelInput.applyProjected(
      { records: ndjson },
      { records: ['{{NUMBER_SECRET}}', '{{BOOLEAN_SECRET}}'] }
    )
    expect(typeof patch.records).toBe('string')
    const rebuilt = String(patch.records)
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(rebuilt).toStrictEqual([
      { _id: 'one', chunk_text: '{{NUMBER_SECRET}}', category: '123' },
      { _id: 'two', chunk_text: '{{BOOLEAN_SECRET}}', category: 'true' },
    ])
  })

  it('projects Flint contexts while preserving slugs and JSON-string compatibility', () => {
    const modelInput = flintGeneratePagesTool.request.modelInput
    expect(modelInput?.mode).toBe('project')
    if (modelInput?.mode !== 'project' || !modelInput.applyProjected) {
      throw new Error('Expected Flint generate pages to define a nested projector')
    }
    const items = JSON.stringify([
      { targetPageSlug: '/one', context: 'quote" slash\\ newline\n123 true' },
      { targetPageSlug: '/two', context: 'second' },
    ])
    const projectedSelection = { items: ['{{FLINT_SECRET}}', 'second'] }

    expect(
      modelInput.select({
        apiKey: 'key',
        siteId: 'site',
        templatePageSlug: '/template',
        items,
      })
    ).toStrictEqual({ items: ['quote" slash\\ newline\n123 true', 'second'] })
    const patch = modelInput.applyProjected({ items }, projectedSelection)
    expect(typeof patch.items).toBe('string')
    expect(JSON.parse(String(patch.items))).toStrictEqual([
      { targetPageSlug: '/one', context: '{{FLINT_SECRET}}' },
      { targetPageSlug: '/two', context: 'second' },
    ])
  })
})
