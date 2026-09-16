/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  extractEmbeddedFileRefs,
  hasEmbeddedFileRef,
} from '@/lib/uploads/server/embedded-image-refs'

const KEY = 'workspace/W1/1700000000000-deadbeefdeadbeef-photo.png'
const ENCODED = encodeURIComponent(KEY)

describe('extractEmbeddedFileRefs', () => {
  it('collects de-duplicated keys and ids from the images a document embeds', () => {
    const content = [
      `![a](/api/files/serve/${ENCODED}?context=workspace)`,
      '![b](/api/files/view/wf_abc)',
      '![c](/workspace/W1/files/4bdaf6c4-072e-464e-891d-b6af3b5fe2cc)',
      `![dup](/api/files/serve/s3/${ENCODED})`,
      '![ext](https://cdn.example.com/x.png)',
      '![pub](/api/files/serve/profile-pictures%2Fu1%2Favatar.png)',
    ].join('\n\n')
    const { keys, ids } = extractEmbeddedFileRefs(content)
    expect(keys).toEqual([KEY])
    expect(ids.sort()).toEqual(['4bdaf6c4-072e-464e-891d-b6af3b5fe2cc', 'wf_abc'].sort())
  })

  it('resolves reference-style images and raw <img> tags', () => {
    const content = [
      '![a][ref]',
      '<img alt="b" src="/api/files/view/wf_html">',
      'inline <img src="/api/files/view/wf_inline"> in a sentence',
      '[ref]: /api/files/view/wf_reference',
    ].join('\n\n')
    expect(extractEmbeddedFileRefs(content).ids.sort()).toEqual([
      'wf_html',
      'wf_inline',
      'wf_reference',
    ])
  })

  it('ignores a document that only mentions embed urls without displaying them', () => {
    const content = [
      'The `/api/files/serve/{key}` and `/api/files/view/{id}` endpoints return 401.',
      'A bare url like /api/files/view/wf_mentioned is prose, not an embed.',
      '[a link](/api/files/view/wf_linked) is navigated to, not displayed.',
      '',
      '```http',
      `GET /api/files/serve/${ENCODED}`,
      'GET /workspace/W1/files/wf_fenced',
      '```',
      '',
      '<pre><img src="/api/files/view/wf_shown_as_source"></pre>',
    ].join('\n')
    expect(extractEmbeddedFileRefs(content)).toEqual({ keys: [], ids: [] })
  })

  it('caps total references (keys + ids) at 50 combined', () => {
    const images = [
      ...Array.from({ length: 40 }, (_, i) => `![](/api/files/view/wf_${i})`),
      ...Array.from(
        { length: 40 },
        (_, i) => `![](/api/files/serve/${encodeURIComponent(`workspace/W1/k${i}.png`)})`
      ),
    ]
    const { keys, ids } = extractEmbeddedFileRefs(images.join('\n\n'))
    expect(keys.length + ids.length).toBe(50)
  })
})

describe('hasEmbeddedFileRef', () => {
  const earlierImages = Array.from(
    { length: 50 },
    (_, index) => `![earlier](/api/files/view/wf_earlier_${index})`
  ).join('\n\n')

  it('matches a single image beyond the bulk cap without increasing exported references', () => {
    const content = `${earlierImages}\n\n![last](/api/files/view/wf_last)\n\n![key](/api/files/serve/${ENCODED})`

    expect(hasEmbeddedFileRef(content, { fileId: 'wf_last' })).toBe(true)
    expect(hasEmbeddedFileRef(content, { key: KEY })).toBe(true)
    expect(extractEmbeddedFileRefs(content).ids).toHaveLength(50)
    expect(extractEmbeddedFileRefs(content).keys).toEqual([])
  })

  it.each([
    '![target](/api/files/view/wf%5Ftarget)',
    '![target][image]\n\n[image]: /api/files/view/wf_target',
    '<img src="/api/files/view/wf_target">',
    '- parent\n  - ![target](/api/files/view/wf_target)',
    '| image |\n| --- |\n| ![target](/api/files/view/wf_target) |',
  ])('uses the shared image grammar for %s', (source) => {
    expect(hasEmbeddedFileRef(source, { fileId: 'wf_target' })).toBe(true)
  })

  it.each([
    'Unreferenced text',
    '/api/files/view/wf_target',
    '[link](/api/files/view/wf_target)',
    '`![image](/api/files/view/wf_target)`',
    '```markdown\n![image](/api/files/view/wf_target)\n```',
    '<pre><img src="/api/files/view/wf_target"></pre>',
    '<script><img src="/api/files/view/wf_target"></script>',
    '<style><img src="/api/files/view/wf_target"></style>',
    '![external](https://example.com/api/files/view/wf_target)',
    '![double encoded](/api/files/view/wf%255Ftarget)',
  ])('does not authorize a target merely mentioned by %s', (source) => {
    expect(hasEmbeddedFileRef(`${earlierImages}\n\n${source}`, { fileId: 'wf_target' })).toBe(false)
  })

  it.each([
    '<!-- <img src="/api/files/view/wf_hidden"> -->',
    '<div><!-- <img src="/api/files/view/wf_hidden"> --></div>',
    'inline <!-- <img src="/api/files/view/wf_hidden"> --> text',
    '<div><!-- <img src="/api/files/view/wf_hidden">',
    '<span title="<img src=/api/files/view/wf_hidden>">text</span>',
  ])('excludes HTML comments and attribute text from both reference paths: %s', (source) => {
    expect(extractEmbeddedFileRefs(source)).toEqual({ keys: [], ids: [] })
    expect(hasEmbeddedFileRef(source, { fileId: 'wf_hidden' })).toBe(false)
  })

  it('keeps rendered images around comments and raw source tags', () => {
    const content =
      '<div><!-- <img src="/api/files/view/wf_hidden"> --><img alt="<!--" src="/api/files/view/wf_visible"><script><img src="/api/files/view/wf_script"></script><style><img src="/api/files/view/wf_style"></style><pre><img src="/api/files/view/wf_pre"></pre><img src="/api/files/view/wf_after"></div>'

    expect(extractEmbeddedFileRefs(content).ids).toEqual(['wf_visible', 'wf_after'])
    expect(hasEmbeddedFileRef(content, { fileId: 'wf_visible' })).toBe(true)
    expect(hasEmbeddedFileRef(content, { fileId: 'wf_after' })).toBe(true)
    for (const fileId of ['wf_hidden', 'wf_script', 'wf_style', 'wf_pre']) {
      expect(hasEmbeddedFileRef(content, { fileId })).toBe(false)
    }
  })

  it.each(['pre', 'code', 'kbd', 'script', 'style'])(
    'excludes %s contents across inline HTML token boundaries',
    (tag) => {
      const content = `prefix <${tag}><span><img src="/api/files/view/wf_hidden"></span>![hidden](/api/files/view/wf_markdown)</${tag}> <img src="/api/files/view/wf_visible"> ![after](/api/files/view/wf_after)`

      expect(extractEmbeddedFileRefs(content).ids).toEqual(['wf_visible', 'wf_after'])
      expect(hasEmbeddedFileRef(content, { fileId: 'wf_hidden' })).toBe(false)
      expect(hasEmbeddedFileRef(content, { fileId: 'wf_markdown' })).toBe(false)
      expect(hasEmbeddedFileRef(content, { fileId: 'wf_visible' })).toBe(true)
      expect(hasEmbeddedFileRef(content, { fileId: 'wf_after' })).toBe(true)
    }
  )

  it('uses rendered HTML attribute semantics for references', () => {
    const content =
      '<img alt="src=/api/files/view/wf_hidden" data-src="/api/files/view/wf_data" src="/api/files/view/wf&#95;first" src="/api/files/view/wf_duplicate">'

    expect(extractEmbeddedFileRefs(content).ids).toEqual(['wf_first'])
    expect(hasEmbeddedFileRef(content, { fileId: 'wf_first' })).toBe(true)
    for (const fileId of ['wf_hidden', 'wf_data', 'wf_duplicate']) {
      expect(hasEmbeddedFileRef(content, { fileId })).toBe(false)
    }
  })
})
