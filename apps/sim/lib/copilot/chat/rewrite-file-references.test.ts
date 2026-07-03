/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import {
  type ChatFileRefMaps,
  rewriteMessageFileRefs,
  rewriteResourceFileRefs,
} from '@/lib/copilot/chat/rewrite-file-references'
import type { MothershipResource } from '@/lib/copilot/resources/types'

const OLD_ID = 'wf_oldfileid123'
const NEW_ID = 'wf_newfileid456'
const OLD_KEY = 'workspace/ws-1/1719000000-aabb-cat.png'
const NEW_KEY = 'workspace/ws-1/1720000000-ccdd-cat.png'

const maps: ChatFileRefMaps = {
  fileIds: new Map([[OLD_ID, NEW_ID]]),
  fileKeys: new Map([[OLD_KEY, NEW_KEY]]),
}

const emptyMaps: ChatFileRefMaps = { fileIds: new Map(), fileKeys: new Map() }

function makeMessage(overrides: Partial<PersistedMessage>): PersistedMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: '',
    timestamp: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('rewriteMessageFileRefs', () => {
  it('rewrites serve-URL (encoded key), view-URL, and sim:file refs in content', () => {
    const content = [
      `![cat](/api/files/serve/${encodeURIComponent(OLD_KEY)})`,
      `[open](/api/files/view/${OLD_ID})`,
      `see sim:file/${OLD_ID}`,
    ].join('\n')
    const [result] = rewriteMessageFileRefs([makeMessage({ content })], maps)

    expect(result.content).toContain(`/api/files/serve/${encodeURIComponent(NEW_KEY)}`)
    expect(result.content).toContain(`/api/files/view/${NEW_ID}`)
    expect(result.content).toContain(`sim:file/${NEW_ID}`)
    expect(result.content).not.toContain(OLD_ID)
  })

  it('rewrites text content blocks', () => {
    const [result] = rewriteMessageFileRefs(
      [
        makeMessage({
          contentBlocks: [{ type: 'text', content: `![x](/api/files/view/${OLD_ID})` }],
        }),
      ],
      maps
    )
    expect(result.contentBlocks?.[0].content).toBe(`![x](/api/files/view/${NEW_ID})`)
  })

  it('rewrites attachment chip id and key', () => {
    const [result] = rewriteMessageFileRefs(
      [
        makeMessage({
          fileAttachments: [
            { id: OLD_ID, key: OLD_KEY, filename: 'cat.png', media_type: 'image/png', size: 10 },
          ],
        }),
      ],
      maps
    )
    expect(result.fileAttachments?.[0]).toMatchObject({ id: NEW_ID, key: NEW_KEY })
  })

  it('rewrites context chip fileId but leaves non-file contexts untouched', () => {
    const [result] = rewriteMessageFileRefs(
      [
        makeMessage({
          contexts: [
            { kind: 'file', label: 'cat.png', fileId: OLD_ID },
            { kind: 'workflow', label: 'My flow', workflowId: 'wflow-1' },
          ],
        }),
      ],
      maps
    )
    expect(result.contexts?.[0].fileId).toBe(NEW_ID)
    expect(result.contexts?.[1]).toEqual({
      kind: 'workflow',
      label: 'My flow',
      workflowId: 'wflow-1',
    })
  })

  it('leaves unmapped references unchanged (graceful broken link, never corrupted)', () => {
    const content = '/api/files/view/wf_someotherfile'
    const [result] = rewriteMessageFileRefs([makeMessage({ content })], maps)
    expect(result.content).toBe(content)
  })

  it('returns the input array identity when there is nothing to rewrite', () => {
    const messages = [makeMessage({ content: `see /api/files/view/${OLD_ID}` })]
    expect(rewriteMessageFileRefs(messages, emptyMaps)).toBe(messages)
  })
})

describe('rewriteResourceFileRefs', () => {
  it('rewrites file resources and passes every other type through', () => {
    const resources: MothershipResource[] = [
      { type: 'file', id: OLD_ID, title: 'cat.png' },
      { type: 'workflow', id: 'wflow-1', title: 'My flow' },
      { type: 'file', id: 'wf_unmapped', title: 'other.png' },
    ]
    const result = rewriteResourceFileRefs(resources, maps)
    expect(result[0].id).toBe(NEW_ID)
    expect(result[1]).toEqual(resources[1])
    expect(result[2].id).toBe('wf_unmapped')
  })

  it('returns the input array identity when maps are empty', () => {
    const resources: MothershipResource[] = [{ type: 'file', id: OLD_ID, title: 'cat.png' }]
    expect(rewriteResourceFileRefs(resources, emptyMaps)).toBe(resources)
  })

  it('drops ghost file resources: chat-owned but not copied (e.g. outputs on a branch fork)', () => {
    const resources: MothershipResource[] = [
      { type: 'file', id: OLD_ID, title: 'apple-upload.png' },
      { type: 'file', id: 'wf_banana_output', title: 'banana.png' },
      { type: 'file', id: 'wf_shared_workspace', title: 'shared.pdf' },
      { type: 'workflow', id: 'wflow-1', title: 'My flow' },
    ]
    // Owned by the source chat: the copied upload and the uncopied output.
    // The shared workspace file is not chat-owned and must pass through.
    const owned = new Set([OLD_ID, 'wf_banana_output'])

    const result = rewriteResourceFileRefs(resources, maps, owned)

    expect(result).toEqual([
      { type: 'file', id: NEW_ID, title: 'apple-upload.png' },
      { type: 'file', id: 'wf_shared_workspace', title: 'shared.pdf' },
      { type: 'workflow', id: 'wflow-1', title: 'My flow' },
    ])
  })

  it('drops ghosts even when nothing was copied (empty maps + drop set)', () => {
    const resources: MothershipResource[] = [
      { type: 'file', id: 'wf_banana_output', title: 'banana.png' },
      { type: 'table', id: 'tbl-1', title: 'Orders' },
    ]
    const result = rewriteResourceFileRefs(resources, emptyMaps, new Set(['wf_banana_output']))
    expect(result).toEqual([{ type: 'table', id: 'tbl-1', title: 'Orders' }])
  })

  it('keeps everything when the drop set is empty', () => {
    const resources: MothershipResource[] = [{ type: 'file', id: OLD_ID, title: 'cat.png' }]
    expect(rewriteResourceFileRefs(resources, emptyMaps, new Set())).toBe(resources)
  })
})
