/**
 * @vitest-environment node
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findModuleEscapes, findRouteReach } from './check-platform-css'

describe('findModuleEscapes', () => {
  it.each([
    'button { color: red; }',
    '[data-platform-ui] { color: red; }',
    ':global(.flex) { display: flex; }',
    '.local, body { color: red; }',
    '@layer base { .local { color: red; } }',
    '@layer components;',
    '@layer theme, base, components, utilities;',
    '@layer components.base { .local { color: red; } }',
    '@layer components { body { color: red; } }',
    '@layer components { :global(.escaped) { color: red; } }',
    '@layer components { .local { :global(.escaped) { color: red; } } }',
    '@layer components { @layer components { .local { color: red; } } }',
    '@font-face { font-family: "X"; }',
    '@property --x { syntax: "*"; inherits: false; }',
    'a[href$=".pdf"] { color: red; }',
    "[data-name='x.y'] { color: red; }",
  ])('flags %s', (css) => {
    expect(findModuleEscapes(css, 'x.module.css')).not.toEqual([])
  })

  it('passes local classes, their keyframes and blocks in the existing components layer', () => {
    const css =
      '.local:hover, textarea.input { color: red; } @media (width > 1px) { .local { color: red; } } ' +
      '@keyframes spin { from { rotate: 0; } to { rotate: 1turn; } } ' +
      '@layer components { .local { color: red; } @media (width > 1px) { .local { color: blue; } } }'
    expect(findModuleEscapes(css, 'x.module.css')).toEqual([])
  })
})

describe('findRouteReach', () => {
  it('names each non-product entry that reaches the design system, through code or CSS', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sim-platform-css-'))
    const put = (file: string, content: string) => {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      writeFileSync(path.join(root, file), content)
    }
    try {
      spawnSync('git', ['init', '-q'], { cwd: root })
      put('packages/emcn-platform/package.json', JSON.stringify({ name: '@sim/emcn-platform' }))
      put('packages/emcn-platform/src/surface.module.css', '.surface { color: red }')
      put('apps/sim/platform/shell.tsx', 'export const Shell = () => null')
      put('apps/sim/app/(product)/page.tsx', `import '@/platform/shell'`)
      put('apps/sim/app/(site)/page.tsx', `import '@/components/banner'`)
      put('apps/sim/components/banner.tsx', `import '@/platform/shell'`)
      put('apps/sim/app/(auth)/layout.tsx', `import './auth.module.css'`)
      put(
        'apps/sim/app/(auth)/auth.module.css',
        `.frame { composes: surface from '../../../../packages/emcn-platform/src/surface.module.css'; }`
      )
      put('apps/sim/app/(docs)/page.tsx', `import '@/components/plain'`)
      put('apps/sim/components/plain.tsx', 'export const Plain = () => null')
      expect(findRouteReach(root)).toEqual([
        {
          rule: 'route-reach',
          detail:
            'app/(auth)/layout.tsx -> app/(auth)/auth.module.css -> ../../packages/emcn-platform/src/surface.module.css',
        },
        {
          rule: 'route-reach',
          detail: 'app/(site)/page.tsx -> components/banner.tsx -> platform/shell.tsx',
        },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
