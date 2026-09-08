import type { Folder, Item } from 'fumadocs-core/page-tree'
import type { LoaderPlugin } from 'fumadocs-core/source'
import navigation from '@/content/integration-navigation.json'

interface IntegrationGuide {
  integration?: string
  title: string
}

const guides: Record<string, IntegrationGuide> = navigation.guides

/** Groups existing page nodes so URLs, content, and page references stay canonical. */
export function integrationNavigationPlugin(): LoaderPlugin {
  return {
    name: 'integration-navigation',
    transformPageTree: {
      folder(node, folderPath) {
        if (folderPath !== 'integrations') return node

        const pages = new Map(
          node.children
            .filter((child): child is Item => child.type === 'page')
            .map((page) => [page.url, page])
        )
        const groupedGuides = new Map<string, Item[]>()
        const sharedGuides: Item[] = []
        const groupedUrls = new Set<string>()

        for (const [slug, guide] of Object.entries(guides)) {
          const page = pages.get(`/integrations/${slug}`)
          if (!page) continue
          const parentUrl = guide.integration ? `/integrations/${guide.integration}` : undefined
          if (parentUrl && !pages.has(parentUrl)) continue

          const child = { ...page, name: guide.title }
          if (parentUrl) {
            const siblings = groupedGuides.get(parentUrl) ?? []
            siblings.push(child)
            groupedGuides.set(parentUrl, siblings)
          } else {
            sharedGuides.push(child)
          }
          groupedUrls.add(page.url)
        }

        for (const guide of navigation.relatedPages) {
          const parentUrl = `/integrations/${guide.integration}`
          if (!pages.has(parentUrl)) continue
          const page = this.builder.file(`${guide.path}.mdx`)
          if (!page) continue
          const siblings = groupedGuides.get(parentUrl) ?? []
          siblings.push({ ...page, name: guide.title })
          groupedGuides.set(parentUrl, siblings)
        }

        const children = node.children
          .filter((child) => child.type !== 'page' || !groupedUrls.has(child.url))
          .map((child) => {
            if (child.type !== 'page') return child
            const nested = groupedGuides.get(child.url)
            if (!nested) return child
            return {
              type: 'folder',
              $id: `${child.$id}-guides`,
              name: child.name,
              icon: child.icon,
              index: child,
              children: nested,
            } satisfies Folder
          })
          .sort((a, b) =>
            typeof a.name === 'string' && typeof b.name === 'string'
              ? a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' })
              : 0
          )

        if (sharedGuides.length > 0) {
          children.push({
            type: 'folder',
            $id: `${node.$id}-shared-guides`,
            name: 'Shared credential guides',
            children: sharedGuides,
          })
        }

        return { ...node, children }
      },
    },
  }
}
