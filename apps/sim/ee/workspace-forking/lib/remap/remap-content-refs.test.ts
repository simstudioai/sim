/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type ForkContentRefMaps,
  rewriteForkContentRefs,
  rewriteForkResourceUrls,
} from '@/ee/workspace-forking/lib/remap/remap-content-refs'

const SRC_KEY = 'workspace/SRC/1700000000000-deadbeef-photo.png'
const DST_KEY = 'workspace/DST/1700000000001-cafebabe-photo.png'

const maps = (): ForkContentRefMaps => ({
  workspaceId: { from: 'SRC', to: 'DST' },
  fileKeys: new Map([[SRC_KEY, DST_KEY]]),
  fileIds: new Map([['file-src', 'file-dst']]),
  workflows: new Map([['wf-src', 'wf-dst']]),
  knowledgeBases: new Map([['kb-src', 'kb-dst']]),
  tables: new Map([['tbl-src', 'tbl-dst']]),
  skills: new Map([['skill-src', 'skill-dst']]),
  folders: new Map([['fld-src', 'fld-dst']]),
})

describe('rewriteForkContentRefs - sim: links', () => {
  it('remaps each mapped sim: link kind by its id map', () => {
    const input = [
      'see [F](sim:file/file-src)',
      '[W](sim:workflow/wf-src)',
      '[K](sim:knowledge/kb-src)',
      '[T](sim:table/tbl-src)',
      '[S](sim:skill/skill-src)',
      '[D](sim:folder/fld-src)',
    ].join(' ')
    expect(rewriteForkContentRefs(input, maps())).toBe(
      [
        'see [F](sim:file/file-dst)',
        '[W](sim:workflow/wf-dst)',
        '[K](sim:knowledge/kb-dst)',
        '[T](sim:table/tbl-dst)',
        '[S](sim:skill/skill-dst)',
        '[D](sim:folder/fld-dst)',
      ].join(' ')
    )
  })

  it('leaves an unmapped id unchanged (graceful broken link)', () => {
    const input = '[F](sim:file/unknown-file) and [I](sim:integration/gmail_v2)'
    expect(rewriteForkContentRefs(input, maps())).toBe(input)
  })

  it('leaves a kind with no supplied map unchanged', () => {
    const input = '[W](sim:workflow/wf-src)'
    expect(rewriteForkContentRefs(input, { fileIds: new Map() })).toBe(input)
  })
})

describe('rewriteForkContentRefs - embedded urls', () => {
  it('remaps a serve-url storage key (encoded form output)', () => {
    const input = `![a](/api/files/serve/${encodeURIComponent(SRC_KEY)}?context=workspace)`
    expect(rewriteForkContentRefs(input, maps())).toBe(
      `![a](/api/files/serve/${encodeURIComponent(DST_KEY)}?context=workspace)`
    )
  })

  it('remaps a serve-url key given in raw (unencoded) form', () => {
    const input = `![a](/api/files/serve/${SRC_KEY})`
    expect(rewriteForkContentRefs(input, maps())).toBe(
      `![a](/api/files/serve/${encodeURIComponent(DST_KEY)})`
    )
  })

  it('remaps an s3/blob-prefixed serve url, preserving the prefix', () => {
    const input = `![a](/api/files/serve/s3/${encodeURIComponent(SRC_KEY)})`
    expect(rewriteForkContentRefs(input, maps())).toBe(
      `![a](/api/files/serve/s3/${encodeURIComponent(DST_KEY)})`
    )
  })

  it('remaps a view-url file id', () => {
    const input = '![a](/api/files/view/file-src)'
    expect(rewriteForkContentRefs(input, maps())).toBe('![a](/api/files/view/file-dst)')
  })

  it('remaps both the workspace id and file id in an in-app files path', () => {
    const input = '![a](/workspace/SRC/files/file-src)'
    expect(rewriteForkContentRefs(input, maps())).toBe('![a](/workspace/DST/files/file-dst)')
  })

  it('leaves a foreign-workspace in-app file path unchanged (both-or-nothing)', () => {
    // The ws id is not the mapped source, so emitting the child file id under OTHER would 404.
    const input = '![a](/workspace/OTHER/files/file-src)'
    expect(rewriteForkContentRefs(input, maps())).toBe(input)
  })

  it('leaves an in-app file path unchanged when the file id is unmapped (both-or-nothing)', () => {
    const input = '![a](/workspace/SRC/files/unknown-file)'
    expect(rewriteForkContentRefs(input, maps())).toBe(input)
  })

  it('leaves an unmapped storage key / file id unchanged', () => {
    const input =
      '![a](/api/files/serve/workspace%2FSRC%2Funknown.png) ![b](/api/files/view/unknown-id)'
    expect(rewriteForkContentRefs(input, maps())).toBe(input)
  })

  it('leaves an external / data url unchanged', () => {
    const input = '![a](https://cdn.example.com/x.png) ![b](data:image/png;base64,AAAA)'
    expect(rewriteForkContentRefs(input, maps())).toBe(input)
  })
})

describe('rewriteForkContentRefs - mixed and edge cases', () => {
  it('rewrites multiple references of different shapes in one string', () => {
    const input = [
      'intro [S](sim:skill/skill-src)',
      `![img](/api/files/serve/${encodeURIComponent(SRC_KEY)})`,
      'link [W](sim:workflow/wf-src)',
      '![v](/api/files/view/file-src)',
    ].join('\n')
    const output = rewriteForkContentRefs(input, maps())
    expect(output).toContain('sim:skill/skill-dst')
    expect(output).toContain('sim:workflow/wf-dst')
    expect(output).toContain(encodeURIComponent(DST_KEY))
    expect(output).toContain('/api/files/view/file-dst')
  })

  it('returns the input unchanged when there are no references', () => {
    const input = '# Heading\n\nNo references here, just text.'
    expect(rewriteForkContentRefs(input, maps())).toBe(input)
  })

  it('returns the input unchanged for an empty string', () => {
    expect(rewriteForkContentRefs('', maps())).toBe('')
  })

  it('leaves a malformed (un-decodable) serve key unchanged', () => {
    const input = '![a](/api/files/serve/%E0%A4%A)'
    expect(rewriteForkContentRefs(input, maps())).toBe(input)
  })

  it('does nothing when no maps are supplied', () => {
    const input = `[S](sim:skill/skill-src) ![a](/api/files/serve/${SRC_KEY})`
    expect(rewriteForkContentRefs(input, {})).toBe(input)
  })
})

describe('rewriteForkResourceUrls - table cell resource chip urls', () => {
  it('rewrites the workspace id + resource id for each section when the resource is mapped', () => {
    expect(rewriteForkResourceUrls('/workspace/SRC/w/wf-src', maps())).toBe(
      '/workspace/DST/w/wf-dst'
    )
    expect(rewriteForkResourceUrls('/workspace/SRC/tables/tbl-src', maps())).toBe(
      '/workspace/DST/tables/tbl-dst'
    )
    expect(rewriteForkResourceUrls('/workspace/SRC/knowledge/kb-src', maps())).toBe(
      '/workspace/DST/knowledge/kb-dst'
    )
    expect(rewriteForkResourceUrls('/workspace/SRC/files/file-src', maps())).toBe(
      '/workspace/DST/files/file-dst'
    )
  })

  it('leaves an unmapped resource id unchanged (both-or-nothing -> graceful plain link)', () => {
    expect(rewriteForkResourceUrls('/workspace/SRC/w/wf-unknown', maps())).toBe(
      '/workspace/SRC/w/wf-unknown'
    )
  })

  it('leaves a foreign / unknown workspace id unchanged', () => {
    expect(rewriteForkResourceUrls('/workspace/OTHER/w/wf-src', maps())).toBe(
      '/workspace/OTHER/w/wf-src'
    )
  })

  it('leaves a non-matching string (unknown section / no resource path) unchanged', () => {
    const input = 'text /workspace/ and /workspace/SRC/settings/x and /workspace/SRC/w/'
    expect(rewriteForkResourceUrls(input, maps())).toBe(input)
  })

  it('does nothing without a workspaceId map', () => {
    const input = '/workspace/SRC/w/wf-src'
    expect(rewriteForkResourceUrls(input, { workflows: new Map([['wf-src', 'wf-dst']]) })).toBe(
      input
    )
  })

  it('rewrites a URL embedded mid-text', () => {
    const input = 'See [chip](/workspace/SRC/knowledge/kb-src) here'
    expect(rewriteForkResourceUrls(input, maps())).toBe(
      'See [chip](/workspace/DST/knowledge/kb-dst) here'
    )
  })
})
