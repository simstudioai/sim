import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Folder, Item, Node } from 'fumadocs-core/page-tree'
import { loader, type MetaData, type VirtualFile } from 'fumadocs-core/source'
import matter from 'gray-matter'
import { describe, expect, it } from 'vitest'
import { integrationNavigationPlugin } from '@/lib/integration-navigation'
import { DOCS_REDIRECTS } from '@/lib/redirects'
import navigation from '@/content/integration-navigation.json'

const contentDir = path.resolve(import.meta.dirname, '../content/docs')
const files: VirtualFile[] = readdirSync(contentDir, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.mdx') || file.endsWith('/meta.json') || file === 'meta.json')
  .map((file) => {
    const content = readFileSync(path.join(contentDir, file), 'utf8')
    return file.endsWith('.mdx')
      ? { type: 'page', path: file, data: matter(content).data }
      : { type: 'meta', path: file, data: JSON.parse(content) }
  })

const original = loader({ files }, { baseUrl: '/' })
const source = loader({ files }, { baseUrl: '/', plugins: [integrationNavigationPlugin()] })

function folders(nodes: Node[]): Folder[] {
  return nodes.flatMap((node) => (node.type === 'folder' ? [node, ...folders(node.children)] : []))
}

function pages(nodes: Node[]): Item[] {
  return nodes.flatMap((node) => {
    if (node.type === 'page') return [node]
    if (node.type === 'folder')
      return [...(node.index ? [node.index] : []), ...pages(node.children)]
    return []
  })
}

function integrationFolder() {
  const folder = folders(source.pageTree.children).find(
    (node) => node.index?.url === '/integrations'
  )
  expect(folder).toBeDefined()
  return folder!
}

describe('docs section navigation', () => {
  it('links every non-root section overview from its folder without repeating it in the children', () => {
    const sections = files.filter(
      (file) => file.type === 'meta' && !file.data.root && file.path !== 'meta.json'
    )
    const treeFolders = folders(source.pageTree.children)
    for (const section of sections) {
      const directory = path.dirname(section.path)
      if (!files.some((file) => file.path === `${directory}/index.mdx`)) continue
      expect((section.data as MetaData).pages, section.path).not.toContain('index')
      const folder = treeFolders.find((node) => node.index?.url === `/${directory}`)
      expect(folder, section.path).toBeDefined()
      expect(pages(folder!.children).map((page) => page.url)).not.toContain(`/${directory}`)
    }
  })

  it('preserves the visible URLs, their order, and canonical page references exactly once', () => {
    const before = pages(original.pageTree.children)
    const after = pages(source.pageTree.children)
    expect(after.map((page) => page.url).sort()).toEqual(
      [...before.map((page) => page.url), '/workflows/blocks/logs'].sort()
    )
    expect(new Set(after.map((page) => page.url)).size).toBe(after.length)
    for (const page of after) {
      expect(source.getNodePage(page)?.url, page.url).toBe(page.url)
    }
    const primaryNames = integrationFolder().children.flatMap((node) => {
      if (node.type === 'page' || (node.type === 'folder' && node.index)) return [String(node.name)]
      return []
    })
    expect(primaryNames).toEqual(
      [...primaryNames].sort((a, b) =>
        a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
      )
    )
  })
})

describe('integration guide navigation', () => {
  it('places every registered guide under its integration or the shared guide folder', () => {
    for (const [slug, guide] of Object.entries(navigation.guides)) {
      const url = `/integrations/${slug}`
      const parentUrl = 'integration' in guide ? `/integrations/${guide.integration}` : undefined
      const folder = integrationFolder().children.find(
        (node) =>
          node.type === 'folder' &&
          (parentUrl ? node.index?.url === parentUrl : node.name === 'Shared credential guides')
      )
      expect(folder, slug).toBeDefined()
      expect(folder?.type === 'folder' && folder.children).toEqual(
        expect.arrayContaining([expect.objectContaining({ url, name: guide.title })])
      )
      expect(source.getPage(['integrations', slug]), slug).toBeDefined()
    }
  })

  it('redirects legacy integration aliases and excludes them from the sidebar', () => {
    const urls = pages(source.pageTree.children).map((page) => page.url)
    for (const [from, to] of Object.entries(navigation.redirects)) {
      expect(source.getPage(['integrations', from])).toBeUndefined()
      expect(urls).not.toContain(`/integrations/${from}`)
      expect(urls).toContain(`/integrations/${to}`)
      expect(DOCS_REDIRECTS).toContainEqual({
        source: `/integrations/${from}`,
        destination: `/integrations/${to}`,
        permanent: true,
      })
    }
  })

  it('keeps an orphaned guide reachable if its integration page is missing', () => {
    const orphan = loader(
      {
        files: [
          { type: 'page', path: 'integrations/index.mdx', data: { title: 'Integrations' } },
          {
            type: 'page',
            path: 'integrations/airtable-service-account.mdx',
            data: { title: 'Airtable Personal Access Tokens' },
          },
        ],
      },
      { baseUrl: '/', plugins: [integrationNavigationPlugin()] }
    )
    expect(pages(orphan.pageTree.children).map((page) => page.url)).toContain(
      '/integrations/airtable-service-account'
    )
    expect(folders(orphan.pageTree.children).map((node) => node.name)).toEqual(['Integrations'])
  })
})
