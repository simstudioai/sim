import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type ContentCheckConfig,
  checkContent,
  checkMergedSlugTargets,
  indexPosts,
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
  frontmatter: Record<string, string> = {}
) {
  const fields = {
    slug,
    ...CLEAN_FRONTMATTER,
    ogImage: `/${section}/${slug}/cover.jpg`,
    ...frontmatter,
  }
  const yaml = Object.entries(fields)
    .map(([key, value]) => (value.startsWith('\n') ? `${key}:${value}` : `${key}: ${value}`))
    .join('\n')
  const dir = path.join(config.contentDir, section, slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'index.mdx'), `---\n${yaml}\n---\n\n${body}\n`)
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
    reservedSegments: { blog: new Set(['tags']), library: new Set(['tags']), customers: new Set() },
    mergedSlugs: { 'old-guide': 'kept-guide' },
    movedBlogSlugs: ['moved-post'],
  }
  mkdirSync(path.join(config.contentDir, 'authors'), { recursive: true })
  writeFileSync(path.join(config.contentDir, 'authors', 'sim.json'), '{"id":"sim","name":"Sim"}')
  writePost('library', 'kept-guide', 'The surviving guide.')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('check-library-content', () => {
  it('passes a clean post with valid internal links, assets, reserved routes, and code samples', async () => {
    writePost(
      'library',
      'clean',
      [
        '## Overview',
        'See [the guide](/library/kept-guide) and https://www.sim.ai/library/kept-guide#intro.',
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
    ])
  })

  it('rejects a retired slug whose replacement no longer exists', () => {
    config.mergedSlugs = { 'old-guide': 'gone-guide' }
    const findings = checkMergedSlugTargets(config, indexPosts(config.contentDir), 'map.ts')
    expect(findings.map((finding) => finding.message)).toEqual([
      'Retired slug "old-guide" redirects to /library/gone-guide, which does not exist.',
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
