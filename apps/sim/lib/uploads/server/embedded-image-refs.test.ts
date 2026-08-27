/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { extractEmbeddedFileRefs } from '@/lib/uploads/server/embedded-image-refs'

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
