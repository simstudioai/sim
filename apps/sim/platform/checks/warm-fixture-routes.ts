import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { escapeRegExp } from '@sim/utils/string'
import { FIXTURE_READY_TIMEOUT_MS, fixtureUrl } from '@/platform/checks/routes'
import { warmPages } from '@/platform/checks/warm-pages'

/** The product's route group, whose `page.tsx` folders are the pages the server compiles one by one. */
const PRODUCT_ROUTES = path.resolve(__dirname, '../../app/(product)')

/** A route a check opens by name: the first argument of a `fixtureUrl(...)` call. */
const SPEC_ROUTE = /fixtureUrl\(\s*(?:'([^']*)'|`([^`]*)`)/g

/** A same-origin link in a page's markup. */
const PAGE_LINK = /href="(\/[^"#?]*)/g

interface ProductPage {
  /** The page's folder under the route group, which identifies what the server compiles. */
  folder: string
  matcher: RegExp
  staticSegments: number
}

/** Every product page, with a matcher for the paths it serves. */
function productPages(): ProductPage[] {
  return readdirSync(PRODUCT_ROUTES, { recursive: true, encoding: 'utf8' })
    .filter((file) => path.basename(file) === 'page.tsx')
    .map((file) => {
      const folder = path.dirname(file)
      let pattern = ''
      let staticSegments = 0
      for (const segment of folder.split(path.sep)) {
        if (segment === '.' || /^\(.+\)$/.test(segment)) continue
        if (segment.startsWith('[[...')) pattern += '(?:/[^/]+)*'
        else if (segment.startsWith('[...')) pattern += '(?:/[^/]+)+'
        else if (segment.startsWith('[')) pattern += '/[^/]+'
        else {
          pattern += `/${escapeRegExp(segment)}`
          staticSegments += 1
        }
      }
      return { folder, matcher: new RegExp(`^${pattern || '/'}$`), staticSegments }
    })
}

/** The page that serves `pathname`: a static segment wins over a dynamic one, as in Next. */
function pageFor(pages: ProductPage[], pathname: string) {
  let best: ProductPage | undefined
  for (const page of pages) {
    if (!page.matcher.test(pathname)) continue
    if (!best || page.staticSegments > best.staticSegments) best = page
  }
  return best
}

/**
 * The routes this suite's checks open by name, read from their sources so a new check warms its
 * own routes. A route whose path is built at run time is left to the others that share its page.
 */
function specRoutes() {
  const routes = new Set<string>()
  for (const file of readdirSync(__dirname)) {
    if (!file.endsWith('.ts')) continue
    const source = readFileSync(path.join(__dirname, file), 'utf8')
    for (const [, quoted, template] of source.matchAll(SPEC_ROUTE)) {
      const route = (quoted ?? template ?? '').split('?')[0]
      if (route.startsWith('/') && !route.includes('${')) routes.add(route)
    }
  }
  return [...routes]
}

/**
 * Compiles, before the first check runs, each product page the checks open by name and each page
 * linked beneath one of them (a list's details, which checks reach by clicking a row), one
 * document per page with every chunk it names. The fixture server compiles a page on its first
 * visit, which otherwise lands inside a check and outlasts its assertion's deadline.
 */
export default async function warmFixtureRoutes() {
  const pages = productPages()
  const claimed = new Set<string>()
  const claim = (url: URL) => {
    const key = pageFor(pages, url.pathname)?.folder ?? url.pathname
    if (claimed.has(key)) return false
    claimed.add(key)
    return true
  }
  const named = specRoutes()
    .map((route) => new URL(fixtureUrl(route)))
    .filter(claim)
  await warmPages(
    named.map((url) => url.href),
    FIXTURE_READY_TIMEOUT_MS,
    (page, html) => {
      const details: string[] = []
      for (const [, link] of html.matchAll(PAGE_LINK)) {
        if (!link.startsWith(`${page.pathname}/`)) continue
        const url = new URL(link, page)
        if (claim(url)) details.push(url.href)
      }
      return details
    }
  )
}
