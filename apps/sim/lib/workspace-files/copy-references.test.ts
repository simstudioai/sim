import { describe, expect, it } from 'vitest'
import { rewriteCopiedFileReferences } from '@/lib/workspace-files/copy-references'

const workspaceOwner = { entityType: 'workspace', entityId: 'source-ws' } as const
const projectOwner = { entityType: 'project', entityId: 'target-project' } as const
const sourceKey = 'workspace/source-ws/123-photo.png'
const maps = {
  sourceOwner: workspaceOwner,
  destinationOwner: projectOwner,
  fileIds: new Map([['photo-1', 'copied-photo']]),
  fileKeys: new Map([[sourceKey, 'copied-photo']]),
}

const projectBytes = '/api/projects/target-project/files/copied-photo/content'

describe('selected copy references', () => {
  it('rewrites selected neutral identities without touching other IDs or resources', () => {
    const source = [
      '![photo](/api/files/view/photo-1)',
      '[selected](sim:file/photo-1)',
      '[other](sim:file/photo-10)',
      '[table](sim:table/photo-1)',
      '![not selected](/api/files/view/other)',
    ].join('\n')
    expect(rewriteCopiedFileReferences(source, maps)).toBe(
      [
        `![photo](${projectBytes})`,
        '[selected](sim:file/copied-photo)',
        '[other](sim:file/photo-10)',
        '[table](sim:table/photo-1)',
        '![not selected](/api/files/view/other)',
      ].join('\n')
    )
  })

  it('normalizes selected raw and encoded storage URLs to destination bytes', () => {
    const source = [
      `/api/files/serve/${sourceKey}`,
      `/api/files/serve/s3/${encodeURIComponent(sourceKey)}?context=workspace`,
      `/api/files/serve/blob/${encodeURIComponent(sourceKey)}`,
      `/api/files/serve/gcs/${encodeURIComponent(sourceKey)}`,
    ]
      .map((url) => `![photo](${url})`)
      .join('\n')
    expect(rewriteCopiedFileReferences(source, maps)).toBe(
      Array.from({ length: 4 }, () => `![photo](${projectBytes})`).join('\n')
    )
  })

  it('requires the exact source owner prefix even if a foreign key is accidentally mapped', () => {
    const foreign = 'workspace/source-ws-other/123-photo.png'
    const source = `![photo](/api/files/serve/${encodeURIComponent(foreign)})`
    expect(
      rewriteCopiedFileReferences(source, {
        ...maps,
        fileKeys: new Map([[foreign, 'copied-photo']]),
      })
    ).toBe(source)
  })

  it('moves both workspace-qualified identities to the destination Project and keeps fragments', () => {
    const source =
      '[app](/workspace/source-ws/files/photo-1#caption) [chip](sim:file/photo-1?workspace=source-ws#caption)'
    expect(rewriteCopiedFileReferences(source, maps)).toBe(
      '[app](/projects/target-project/files/copied-photo#caption) [chip](sim:file/copied-photo?project=target-project#caption)'
    )
  })

  it('moves Project-qualified identities and bytes to a workspace', () => {
    const source = [
      '[app](/projects/target-project/files/photo-1)',
      '[chip](sim:file/photo-1?project=target-project)',
      '![photo](/api/projects/target-project/files/photo-1/content)',
      '![key](/api/files/serve/project%2Ftarget-project%2F123-photo.png)',
    ].join('\n')
    expect(
      rewriteCopiedFileReferences(source, {
        ...maps,
        sourceOwner: projectOwner,
        destinationOwner: workspaceOwner,
        fileKeys: new Map([['project/target-project/123-photo.png', 'copied-photo']]),
      })
    ).toBe(
      [
        '[app](/workspace/source-ws/files/copied-photo)',
        '[chip](sim:file/copied-photo?workspace=source-ws)',
        '![photo](/api/files/view/copied-photo)',
        '![key](/api/files/view/copied-photo)',
      ].join('\n')
    )
  })

  it('preserves foreign or ambiguous ownership and unsupported file paths', () => {
    const source = [
      'sim:file/photo-1?workspace=other',
      'sim:file/photo-1?project=target-project',
      'sim:file/photo-1?workspace=source-ws&project=target-project',
      'sim:file/photo-1?workspace=source-ws&workspace=source-ws',
      '/workspace/other/files/photo-1',
      '/projects/target-project/files/photo-1',
      '/api/projects/target-project/files/photo-1/content',
      '/api/files/view/photo-1/extra',
      '/api/files/view/photo-1?project=other',
    ].join('\n')
    expect(rewriteCopiedFileReferences(source, maps)).toBe(source)
  })

  it('does not turn absolute or protocol-relative URLs into local destination references', () => {
    const source = [
      'https://other.test/api/files/view/photo-1',
      '//other.test/api/files/view/photo-1',
      'https://other.test/workspace/source-ws/files/photo-1',
      'https://other.test/?next=/api/files/view/photo-1',
      'https://other.test/a(/api/files/view/photo-1)',
      'prefixsim:file/photo-1',
      'x/api/files/view/photo-1',
    ].join('\n')
    expect(rewriteCopiedFileReferences(source, maps)).toBe(source)
  })

  it('decodes once while preserving malformed and twice-encoded references', () => {
    const source = [
      '/api/files/view/photo%2D1',
      '/api/files/view/photo%252D1',
      '/api/files/view/%E0%A4%A',
      '/workspace/source%2Dws/files/photo%2D1',
    ].join('\n')
    expect(rewriteCopiedFileReferences(source, maps)).toBe(
      [
        projectBytes,
        '/api/files/view/photo%252D1',
        '/api/files/view/%E0%A4%A',
        '/projects/target-project/files/copied-photo',
      ].join('\n')
    )
  })

  it('applies each selected mapping once without cascading into another selected identity', () => {
    expect(
      rewriteCopiedFileReferences('sim:file/photo-1 sim:file/copied-photo', {
        ...maps,
        fileIds: new Map([
          ['photo-1', 'copied-photo'],
          ['copied-photo', 'third-photo'],
        ]),
      })
    ).toBe('sim:file/copied-photo sim:file/third-photo')
  })

  it('rewrites only selected Office helper and input-path identities', () => {
    const source = [
      "const image = await getFileBase64('photo-1')",
      'await addImage(slide, "photo-1", options)',
      "await addImage('photo-1', options)",
      "drawImage(page, 'photo-1', opts)",
      "Doc.open(input_path('photo-1'))",
      "fs.readFileSync('/home/user/inputs/photo-1')",
      "getFileBase64('unselected')",
      'getFileBase64(variable)',
      "slide.addText('photo-1')",
    ].join('\n')
    expect(rewriteCopiedFileReferences(source, maps, 'javascript')).toBe(
      [
        "const image = await getFileBase64('copied-photo')",
        'await addImage(slide, "copied-photo", options)',
        "await addImage('copied-photo', options)",
        "drawImage(page, 'copied-photo', opts)",
        "Doc.open(input_path('copied-photo'))",
        "fs.readFileSync('/home/user/inputs/copied-photo')",
        "getFileBase64('unselected')",
        'getFileBase64(variable)',
        "slide.addText('photo-1')",
      ].join('\n')
    )
  })

  it.each(['javascript', 'python'] as const)(
    'copies unfinished %s document source without partial reference rewrites',
    (language) => {
      const source = [
        'link = "/api/files/view/photo-1"',
        'image = getFileBase64("photo-1")',
        'unfinished = "unterminated',
      ].join('\n')
      expect(rewriteCopiedFileReferences(source, maps, language)).toBe(source)
    }
  )
})
