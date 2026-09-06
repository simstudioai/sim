/**
 * @vitest-environment jsdom
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type AnchorHTMLAttributes, act, type ReactNode } from 'react'
import ts from '@typescript/typescript6'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LandingShell } from '@/app/(landing)/components/landing-shell/landing-shell'

interface TestLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string
}

const { setTheme } = vi.hoisted(() => ({ setTheme: vi.fn() }))

vi.mock('@sim/emcn', () => ({
  cn: (...values: unknown[]) => values.flat().filter(Boolean).join(' '),
  ChipLink: ({ href, children, className }: TestLinkProps) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))
vi.mock('@sim/emcn/icons', () => ({ Moon: () => null, Sun: () => null }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: TestLinkProps) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}))
vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light', setTheme }),
}))
vi.mock('@/lib/core/config/env-flags', () => ({ isHosted: true }))
vi.mock('@/lib/github/stars', () => ({ getGitHubStars: vi.fn().mockResolvedValue(29_500) }))
vi.mock('@/app/(landing)/components/navbar/navbar', () => ({
  Navbar: () => <nav aria-label='Primary navigation' />,
}))
vi.mock('@/app/(landing)/components/site-structured-data', () => ({
  SiteStructuredData: () => null,
}))
vi.mock('@/app/(landing)/components/footer/components/footer-wordmark-loop', () => ({
  FooterWordmarkLoop: () => null,
}))
vi.mock('@/app/_shell/consent/consent-preferences-trigger', () => ({
  ConsentPreferencesTrigger: ({ children }: { children: ReactNode }) => (
    <button type='button'>{children}</button>
  ),
}))
vi.mock('@/app/(landing)/comparisons/utils', () => ({
  ALL_COMPETITORS: [{ id: 'n8n', name: 'n8n' }],
}))
vi.mock('@/app/(landing)/models/utils', () => ({
  MODEL_PROVIDERS_WITH_CATALOGS: [{ name: 'OpenAI', href: '/models/openai' }],
}))

let host: HTMLDivElement
let root: Root | undefined

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setTheme.mockClear()
  root = undefined
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  host.remove()
})

function renderShell() {
  return LandingShell({
    children: (
      <main id='main-content'>
        <h1>Page-specific marketing content</h1>
        <p>The page supplies its own content.</p>
      </main>
    ),
  })
}

function requiredElement<T extends Element>(selector: string, scope: ParentNode = host): T {
  const element = scope.querySelector<T>(selector)
  if (!element) throw new Error(`Expected ${selector} in the marketing shell`)
  return element
}

describe('LandingShell shared closing section', () => {
  it('places one painted CTA after page content and before the shared footer with both themes and correct actions', async () => {
    host.innerHTML = renderToStaticMarkup(await renderShell())
    const main = requiredElement('main')
    const cta = requiredElement('#cta')
    const footer = requiredElement('footer')
    expect(host.querySelectorAll('#cta')).toHaveLength(1)
    expect(host.querySelectorAll('#cta-heading')).toHaveLength(1)
    expect(host.querySelectorAll('footer')).toHaveLength(1)
    expect(main.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(cta.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(main.contains(cta)).toBe(false)
    expect(requiredElement('#cta-heading').textContent).toBe(
      'Every agent your company runs. All in one place. '
    )
    expect(Array.from(cta.querySelectorAll('img'), (image) => image.getAttribute('src'))).toEqual([
      '/landing/cta-san-francisco-painted-light.webp',
      '/landing/cta-san-francisco-painted-dark.webp',
    ])
    expect(Array.from(cta.querySelectorAll('img'), (image) => image.alt)).toEqual(['', ''])
    expect(
      Array.from(cta.querySelectorAll('a'), (link) => ({
        label: link.textContent?.trim(),
        href: link.getAttribute('href'),
      }))
    ).toEqual([
      { label: 'Request a demo', href: '/demo' },
      { label: 'Start building', href: '/signup' },
    ])
  })

  it('keeps the universal footer navigation and usable light/dark control on arbitrary marketing pages', async () => {
    const shell = await renderShell()
    root = createRoot(host)
    act(() => root?.render(shell))
    const footer = requiredElement('footer')
    const navigation = requiredElement('nav[aria-label="Footer navigation"]', footer)
    expect(Array.from(navigation.querySelectorAll('h3'), (heading) => heading.textContent)).toEqual(
      ['Product', 'Resources', 'Compare', 'Integrations', 'Models', 'Socials', 'Legal']
    )
    for (const href of [
      '/enterprise',
      '/workflows',
      '/knowledge',
      '/tables',
      '/files',
      '/logs',
      '/blog',
      '/library',
      '/careers',
      '/contact',
      '/comparisons',
      '/integrations',
      '/models',
      '/terms',
      '/privacy',
      '/cookie-policy',
    ]) {
      expect(navigation.querySelector(`a[href="${href}"]`)).not.toBeNull()
    }
    const themes = requiredElement('[role="radiogroup"][aria-label="Color theme"]', footer)
    const light = requiredElement<HTMLInputElement>('input[aria-label="Light theme"]', themes)
    const dark = requiredElement<HTMLInputElement>('input[aria-label="Dark theme"]', themes)
    expect(light.checked).toBe(true)
    expect(dark.checked).toBe(false)
    act(() => dark.click())
    expect(setTheme).toHaveBeenCalledExactlyOnceWith('dark')
  })

  it('reserves closing CTA and footer ownership for the shared shell across marketing routes', () => {
    const landingDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const shellPath = 'components/landing-shell/landing-shell.tsx'
    const ctaPath = 'components/cta/cta.tsx'
    const footerPath = 'components/footer/footer.tsx'
    const violations: string[] = []
    const files = readdirSync(landingDirectory, { recursive: true }).filter(
      (file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx')
    )
    for (const file of files) {
      const source = ts.createSourceFile(
        file,
        readFileSync(join(landingDirectory, file), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      )
      const closingComponents = new Set(['Cta', 'Footer'])
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) continue
        const bindings = statement.importClause?.namedBindings
        if (!bindings || !ts.isNamedImports(bindings)) continue
        for (const binding of bindings.elements) {
          if (['Cta', 'Footer'].includes((binding.propertyName ?? binding.name).text))
            closingComponents.add(binding.name.text)
        }
      }
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(source)
          if (closingComponents.has(tag) && file !== shellPath) violations.push(`${file}: ${tag}`)
          if (tag === 'footer' && file !== footerPath) violations.push(`${file}: footer landmark`)
          for (const attribute of node.attributes.properties) {
            if (!ts.isJsxAttribute(attribute) || attribute.name.getText(source) !== 'id') continue
            const value = attribute.initializer
            if (
              value &&
              ts.isStringLiteral(value) &&
              ['cta', 'cta-heading'].includes(value.text) &&
              file !== ctaPath
            )
              violations.push(`${file}: duplicate closing ${value.text}`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect(violations).toEqual([])
  })
})
