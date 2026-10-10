import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type ContentCheckConfig,
  checkContent,
  checkRedirectTargets,
  indexPosts,
  readReservedSegments,
  resolvePostArg,
} from './check-library-content'

let root: string
let config: ContentCheckConfig

const CLEAN_FRONTMATTER = {
  title: 'A clean library post',
  description: 'A description that is comfortably over twenty characters.',
  date: '2026-09-01',
  authors: '[sim]',
}

function writePost(
  section: string,
  slug: string,
  body: string,
  frontmatter: Record<string, string> = {},
  includeMedia = true
) {
  const fields = {
    slug,
    ...CLEAN_FRONTMATTER,
    ogImage: `/${section}/${slug}/cover.jpg`,
    ...(section === 'changelog' ? { ogAlt: 'A sample workflow result in Sim' } : {}),
    ...frontmatter,
  }
  const yaml = Object.entries(fields)
    .map(([key, value]) => (value.startsWith('\n') ? `${key}:${value}` : `${key}: ${value}`))
    .join('\n')
  const dir = path.join(config.contentDir, section, slug)
  mkdirSync(dir, { recursive: true })
  const media =
    section === 'changelog' && includeMedia
      ? `\n<ChangelogImage src="/${section}/${slug}/cover.jpg" alt="A sample workflow result" width="1200" height="675" caption="The result of the demonstrated workflow." />\n`
      : ''
  writeFileSync(path.join(dir, 'index.mdx'), `---\n${yaml}\n---\n\n${body}\n${media}`)
  const imageDir = path.join(config.publicDir, section, slug)
  mkdirSync(imageDir, { recursive: true })
  writeFileSync(path.join(imageDir, 'cover.jpg'), '')
}

async function findingsFor(section: string, slug: string) {
  const { findings } = await checkContent(config, [{ section: section as 'library', slug }])
  return findings.map(({ line, rule, message }) => ({ line, rule, message }))
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'library-content-'))
  config = {
    contentDir: path.join(root, 'content'),
    publicDir: path.join(root, 'public'),
    reservedSegments: {
      blog: new Set(['tags']),
      library: new Set(['tags']),
      customers: new Set(),
      changelog: new Set(['archive', 'preview']),
    },
    mergedSlugs: { 'old-guide': 'kept-guide' },
    movedBlogSlugs: ['moved-post'],
    customerSlugs: ['acme'],
    linkedPages: new Set([
      'https://www.sim.ai/integrations/you-com',
      'https://docs.sim.ai/workflows/deployment',
      'https://www.sim.ai/models/anthropic',
      'https://www.sim.ai/models/anthropic/claude-opus-4-6',
    ]),
  }
  mkdirSync(path.join(config.contentDir, 'authors'), { recursive: true })
  writeFileSync(path.join(config.contentDir, 'authors', 'sim.json'), '{"id":"sim","name":"Sim"}')
  writePost('library', 'kept-guide', 'The surviving guide.')
  writePost('library', 'moved-post', 'Moved from the blog.')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('check-library-content', () => {
  it.each([
    'An update with only a cover image.',
    '```mdx\n<ChangelogImage src="/changelog/post/cover.jpg" alt="Example" width="1200" height="675" />\n```',
  ])('rejects a published changelog without rendered feature media: %s', async (body) => {
    writePost('changelog', 'post', body, {}, false)
    expect(await findingsFor('changelog', 'post')).toEqual([
      expect.objectContaining({ rule: 'media', message: expect.stringContaining('at least one') }),
    ])
    writePost('changelog', 'post', body, { draft: 'true' }, false)
    expect(await findingsFor('changelog', 'post')).toEqual([])
  })

  it.each([
    { date: '2999-01-01T00:00:00Z' },
    { date: '2026-09-01T00:00:00Z', updated: '2026-08-01T00:00:00Z' },
  ])('rejects misleading publication dates in a changelog: %o', async (dates) => {
    writePost('changelog', 'post', 'A product update.', dates)
    expect(await findingsFor('changelog', 'post')).toEqual([
      expect.objectContaining({ rule: 'frontmatter', message: expect.stringContaining('date') }),
    ])
  })

  it('rejects two published updates with the same RSS identity', async () => {
    const release =
      '\n  versions: [v0.9.10]\n  url: https://github.com/simstudioai/sim/releases/tag/v0.9.10'
    writePost('changelog', 'first-story', 'One capability.', { release })
    writePost('changelog', 'second-story', 'Another capability.', { release })
    const { findings } = await checkContent(config)
    expect(findings).toEqual([
      expect.objectContaining({
        rule: 'frontmatter',
        message: expect.stringContaining('RSS identity'),
      }),
    ])
    writePost('changelog', 'second-story', 'Another capability.', { release, draft: 'true' })
    expect((await checkContent(config)).findings).toEqual([])
  })

  it.each([
    '[You.com](/integrations/youcom)',
    '[Deployment guide](https://docs.sim.ai/workflows/deployments)',
    '[Deployment guide][guide]\n\n[guide]: https://docs.sim.ai/workflows/deployments',
    '<a href="https://docs.sim.ai/workflows/deployments">Deployment guide</a>',
    '[Model provider](/models/missing-provider)',
    '[Model](https://www.sim.ai/models/anthropic/missing-model)',
    '[Model][model]\n\n[model]: /models/anthropic/missing-model',
    '<a href="/models/anthropic/missing-model">Model</a>',
  ])('rejects a changelog backlink to a missing page: %s', async (invalidLink) => {
    writePost(
      'changelog',
      'post',
      [
        '[You.com](/integrations/you-com)',
        '[Deployment guide](https://docs.sim.ai/workflows/deployment?source=changelog#api)',
        '[Anthropic](/models/anthropic/)',
        '[Claude Opus](https://www.sim.ai/models/anthropic/claude-opus-4-6?source=changelog#capabilities)',
        '```md',
        '[Example](https://docs.sim.ai/workflows/missing-example)',
        '```',
        invalidLink,
      ].join('\n\n')
    )
    expect(await findingsFor('changelog', 'post')).toEqual([
      expect.objectContaining({
        rule: 'internal-link',
        message: expect.stringContaining('does not exist'),
      }),
    ])
  })

  it('rejects a changelog link to an unpublished draft', async () => {
    writePost('changelog', 'draft-update', 'Draft.', { draft: 'true' })
    writePost('changelog', 'post', '[Next update](/changelog/draft-update)')
    expect(await findingsFor('changelog', 'post')).toEqual([
      expect.objectContaining({ rule: 'internal-link', message: expect.stringContaining('draft') }),
    ])
  })

  it('rejects a changelog slug that shadows the archive route', async () => {
    writePost('changelog', 'archive', 'Body.')
    expect(await findingsFor('changelog', 'archive')).toEqual([
      expect.objectContaining({ rule: 'slug', message: expect.stringContaining('reserved') }),
    ])
  })

  it('rejects changelog body headings that collide with the page hierarchy', async () => {
    writePost('changelog', 'post', '## Improvements\n\nA clearer comparison.')
    expect(await findingsFor('changelog', 'post')).toEqual([
      expect.objectContaining({ rule: 'mdx', message: expect.stringContaining('heading') }),
    ])
  })

  it('accepts local media and the approved CDN and rejects a lookalike origin', async () => {
    const origin = 'https://nnjgp7vypgx4myuq.public.blob.vercel-storage.com'
    mkdirSync(path.join(config.publicDir, 'changelog/media'), { recursive: true })
    writeFileSync(path.join(config.publicDir, 'changelog/media/demo.mp4'), 'recording')
    writeFileSync(path.join(config.publicDir, 'changelog/media/demo.vtt'), 'WEBVTT\n')
    for (const [slug, src] of [
      ['good-video', `${origin}/changelog/demo-v1.mp4`],
      ['local-video', '/changelog/media/demo.mp4'],
      ['bad-video', `${origin}.example.com/changelog/demo-v1.mp4`],
    ]) {
      writePost(
        'changelog',
        slug,
        `<ChangelogVideo src="${src}" poster="/changelog/${slug}/cover.jpg" caption="Compare deployments" captionsSrc="/changelog/media/demo.vtt" />`
      )
    }
    const { findings } = await checkContent(config)
    expect(findings).toEqual([
      expect.objectContaining({
        file: path.join(config.contentDir, 'changelog/bad-video/index.mdx'),
        rule: 'media',
      }),
    ])
  })

  it.each([
    '<ChangelogImage src="/changelog/post/cover.jpg" alt="Review changes" width={1200} height="800" />',
    '<ChangelogImage src="/changelog/post/cover.jpg" alt="Review changes" width="0" height="800" />',
    '<ChangelogVideo src="/changelog/media/missing.mp4" poster="/changelog/post/cover.jpg" caption="Compare deployments" />',
    '<ChangelogVideo src="https://nnjgp7vypgx4myuq.public.blob.vercel-storage.com/changelog/demo.mp4" poster="/changelog/post/cover.jpg" caption="Compare deployments" captionsSrc="/changelog/media/missing.vtt" />',
    '<ChangelogVideo src="https://nnjgp7vypgx4myuq.public.blob.vercel-storage.com/changelog/demo.mp4" poster="/changelog/missing.jpg" caption="Compare deployments" />',
    '<ChangelogVideo src="https://example.com/demo.mp4" poster="/changelog/post/cover.jpg" caption="Compare deployments" />',
  ])('rejects changelog media that cannot render or load: %s', async (body) => {
    writePost('changelog', 'post', body)
    expect(await findingsFor('changelog', 'post')).toEqual([
      expect.objectContaining({ rule: 'media' }),
    ])
  })

  it('passes a clean post with valid internal links, assets, reserved routes, and code samples', async () => {
    writePost(
      'library',
      'clean',
      [
        '## Overview',
        'See [the guide](/library/kept-guide) and https://www.sim.ai/library/kept-guide#intro.',
        'Read https://www.sim.ai/library/kept-guide. Then https://www.sim.ai/library/moved-post, too.',
        '![diagram](/library/clean/diagram.png) and [tags](/library/tags) are not posts.',
        'An apex https://sim.ai/library/missing link belongs to check:site-urls.',
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |',
        '```md',
        '## FAQ',
        '[old](/library/old-guide)',
        '```',
      ].join('\n')
    )
    expect(await findingsFor('library', 'clean')).toEqual([])
  })

  it('rejects an unknown frontmatter key such as canonical, at its line', async () => {
    writePost('library', 'post', 'Body.', { canonical: 'https://www.sim.ai/library/post' })
    expect(await findingsFor('library', 'post')).toEqual([
      { line: 8, rule: 'frontmatter', message: 'Unknown frontmatter key "canonical".' },
    ])
  })

  it('rejects frontmatter that fails the schema', async () => {
    writePost('library', 'post', 'Body.', { title: 'Hi' })
    const findings = await findingsFor('library', 'post')
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ line: 3, rule: 'frontmatter' })
  })

  it('rejects invalid YAML', async () => {
    writePost('library', 'post', 'Body.', { title: 'Broken: [unclosed' })
    expect((await findingsFor('library', 'post'))[0]).toMatchObject({ rule: 'frontmatter' })
  })

  it('rejects an author with no profile', async () => {
    writePost('library', 'post', 'Body.', { authors: '[ghost]' })
    expect(await findingsFor('library', 'post')).toEqual([
      {
        line: 6,
        rule: 'frontmatter',
        message: 'Author "ghost" has no profile in apps/sim/content/authors.',
      },
    ])
  })

  it('rejects a slug that differs from the folder name', async () => {
    writePost('library', 'post', 'Body.', { slug: 'other' })
    expect(await findingsFor('library', 'post')).toEqual([
      { line: 2, rule: 'slug', message: 'slug "other" does not match the folder name "post".' },
    ])
  })

  it('rejects a missing or remote ogImage', async () => {
    writePost('library', 'missing', 'Body.', { ogImage: '/library/missing/nope.jpg' })
    writePost('library', 'remote', 'Body.', { ogImage: 'https://example.com/a.jpg' })
    expect(await findingsFor('library', 'missing')).toEqual([
      {
        line: 7,
        rule: 'og-image',
        message: 'ogImage "/library/missing/nope.jpg" does not exist under apps/sim/public.',
      },
    ])
    expect((await findingsFor('library', 'remote'))[0]).toMatchObject({ rule: 'og-image' })
  })

  it('reports an MDX compile error at its file line', async () => {
    writePost('library', 'post', 'Intro.\n\nA tag <div that never closes.')
    const findings = await findingsFor('library', 'post')
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ line: 12, rule: 'mdx' })
  })

  it('rejects an FAQ heading in the body', async () => {
    writePost('library', 'post', 'Intro.\n\n## FAQs\n\nQ and A.')
    expect(await findingsFor('library', 'post')).toEqual([
      { line: 12, rule: 'faq', message: 'Body has a "## FAQs" heading.' },
    ])
  })

  it('rejects Markdown link syntax inside an FAQ answer, at the answer line', async () => {
    writePost('library', 'post', 'Body.', {
      faq: '\n  - q: "Plain question?"\n    a: "Plain answer."\n  - q: "Linked?"\n    a: "See [Sim](https://www.sim.ai)."',
    })
    expect(await findingsFor('library', 'post')).toEqual([
      {
        line: 12,
        rule: 'faq',
        message: 'faq[1].a contains Markdown link syntax, which renders as literal text.',
      },
    ])
  })

  it('rejects links to missing, retired, and moved posts, naming the replacement', async () => {
    writePost(
      'library',
      'post',
      [
        '[a](/library/missing)',
        '[b](https://www.sim.ai/library/old-guide)',
        '<a href="/blog/moved-post">c</a>',
        '[d](/blog/kept-guide)',
        'Also see https://www.sim.ai/library/gone.',
        '[e](/library/kept-guide.) and <a href="https://www.sim.ai/library/kept-guide.">f</a>',
      ].join('\n')
    )
    expect(await findingsFor('library', 'post')).toEqual([
      {
        line: 10,
        rule: 'internal-link',
        message: '/library/missing does not exist (no apps/sim/content/library/missing/index.mdx).',
      },
      {
        line: 11,
        rule: 'internal-link',
        message: '/library/old-guide is retired; it was merged into /library/kept-guide.',
      },
      {
        line: 12,
        rule: 'internal-link',
        message: '/blog/moved-post moved to /library/moved-post.',
      },
      {
        line: 13,
        rule: 'internal-link',
        message: '/blog/kept-guide does not exist (no apps/sim/content/blog/kept-guide/index.mdx).',
      },
      {
        line: 14,
        rule: 'internal-link',
        message: '/library/gone does not exist (no apps/sim/content/library/gone/index.mdx).',
      },
      {
        line: 15,
        rule: 'internal-link',
        message:
          '/library/kept-guide. does not exist (no apps/sim/content/library/kept-guide./index.mdx).',
      },
      {
        line: 15,
        rule: 'internal-link',
        message:
          '/library/kept-guide. does not exist (no apps/sim/content/library/kept-guide./index.mdx).',
      },
    ])
  })

  it('rejects a retired slug whose replacement no longer exists', () => {
    config.mergedSlugs = { 'old-guide': 'gone-guide' }
    const findings = checkRedirectTargets(config, indexPosts(config.contentDir), 'map.ts')
    expect(findings.map((finding) => finding.message)).toEqual([
      '/library/old-guide redirects to /library/gone-guide, which does not exist (no apps/sim/content/library/gone-guide/index.mdx).',
    ])
  })

  it('rejects a moved blog slug whose library destination is missing or a draft', () => {
    config.movedBlogSlugs = ['moved-post', 'never-moved']
    writePost('library', 'moved-post', 'Unpublished.', { draft: 'true' })
    const findings = checkRedirectTargets(config, indexPosts(config.contentDir), 'map.ts')
    expect(findings.map((finding) => finding.message)).toEqual([
      '/blog/moved-post redirects to /library/moved-post, which is a draft, so it 404s.',
      '/blog/never-moved redirects to /library/never-moved, which does not exist (no apps/sim/content/library/never-moved/index.mdx).',
    ])
  })

  it('rejects a link to a draft blog or library post', async () => {
    writePost('library', 'unpublished', 'Draft.', { draft: 'true' })
    writePost('library', 'post', '[a](/library/unpublished)')
    expect(await findingsFor('library', 'post')).toEqual([
      {
        line: 10,
        rule: 'internal-link',
        message: '/library/unpublished is a draft, so it 404s.',
      },
    ])
  })

  it('accepts a registered draft customer story but rejects an unregistered one', async () => {
    writePost('customers', 'acme', 'Registered draft.', { draft: 'true' })
    writePost('customers', 'globex', 'Folder without a CUSTOMER_STORIES entry.')
    writePost('library', 'post', '[a](/customers/acme)\n[b](/customers/globex)')
    expect(await findingsFor('library', 'post')).toEqual([
      {
        line: 11,
        rule: 'internal-link',
        message:
          '/customers/globex is not in CUSTOMER_STORIES (apps/sim/lib/customers/data.ts), so it 404s.',
      },
    ])
  })

  it('reserves only sibling folders that define a page or route handler', () => {
    const appDir = path.join(root, 'app')
    for (const [dir, file] of [
      ['tags', 'page.tsx'],
      ['rss.xml', 'route.ts'],
      ['[slug]', 'page.tsx'],
      ['components', 'card.tsx'],
    ]) {
      mkdirSync(path.join(appDir, dir), { recursive: true })
      writeFileSync(path.join(appDir, dir, file), '')
    }
    expect([...readReservedSegments(() => appDir).customers].sort()).toEqual(['rss.xml', 'tags'])
  })

  it('rejects an invalid author profile and does not accept its id', async () => {
    writeFileSync(path.join(config.contentDir, 'authors', 'ghost.json'), '{"id":"ghost"}')
    writeFileSync(path.join(config.contentDir, 'authors', 'broken.json'), '{not json')
    writePost('library', 'post', 'Body.', { authors: '[ghost]' })
    const findings = await findingsFor('library', 'post')
    expect(findings.map(({ rule, message }) => ({ rule, message }))).toEqual([
      { rule: 'frontmatter', message: expect.stringMatching(/^Author profile is invalid/) },
      { rule: 'frontmatter', message: expect.stringMatching(/^Author profile is invalid: name/) },
      {
        rule: 'frontmatter',
        message: 'Author "ghost" has no profile in apps/sim/content/authors.',
      },
    ])
  })

  it('rejects an ogImage that resolves outside public, even when the file exists', async () => {
    writeFileSync(path.join(root, 'secret.jpg'), '')
    writePost('library', 'post', 'Body.', { ogImage: '/../secret.jpg' })
    expect(await findingsFor('library', 'post')).toEqual([
      {
        line: 7,
        rule: 'og-image',
        message: 'ogImage "/../secret.jpg" resolves outside apps/sim/public.',
      },
    ])
  })

  it('resolves a post argument by section/slug or bare slug, and rejects unknown ones', () => {
    const posts = indexPosts(config.contentDir)
    expect(resolvePostArg('library/kept-guide', posts)).toEqual([
      { section: 'library', slug: 'kept-guide' },
    ])
    expect(resolvePostArg('kept-guide', posts)).toEqual([
      { section: 'library', slug: 'kept-guide' },
    ])
    expect(typeof resolvePostArg('blog/kept-guide', posts)).toBe('string')
    expect(typeof resolvePostArg('nope', posts)).toBe('string')
  })
})
