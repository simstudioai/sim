import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { surfaceDiff } from './check-emcn-surface'

const CHECK = fileURLToPath(new URL('./check-emcn-surface.ts', import.meta.url))

it('names each added, removed and changed path between snapshot and live surface', () => {
  expect(
    surfaceDiff(
      { exports: { './button': { names: ['Button'], props: { Button: { size: ['md'] } } } } },
      {
        exports: {
          './button': {
            names: ['Button', 'ButtonProps'],
            props: { Button: { size: { '[]': [] } } },
          },
          './chip': 'asset',
        },
      }
    )
  ).toEqual([
    '+ exports › ./button › names › ButtonProps',
    '~ exports › ./button › props › Button › size: ["md"] → {"[]":[]}',
    '+ exports › ./chip',
  ])
})

it('fails when an export, prop, nested field, parameter, token, selector or class style changes in EMCN', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sim-emcn-surface-'))
  const put = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
  }
  const run = (...args: string[]) => {
    const result = spawnSync('bun', [CHECK, root, ...args], { encoding: 'utf8' })
    return { status: result.status, output: result.stdout + result.stderr }
  }
  try {
    spawnSync('git', ['init', '-q'], { cwd: root })
    mkdirSync(path.join(root, 'scripts'))
    symlinkSync(
      path.resolve(path.dirname(CHECK), '../node_modules'),
      path.join(root, 'node_modules')
    )
    put(
      'packages/emcn/package.json',
      JSON.stringify({
        name: '@sim/emcn',
        exports: {
          './button': './src/button/button.tsx',
          './styles/theme.css': './src/styles/theme.css',
        },
      })
    )
    const theme = ':root { --emcn-ink: #000 }\n[data-theme="dark"] { --emcn-ink: #fff }'
    put('packages/emcn/src/styles/theme.css', theme)
    const sheet = '.button { color: red; padding: 0 4px }'
    put('packages/emcn/src/button/button.module.css', sheet)
    const button = `import type { ReactNode } from 'react'
      export interface MenuAction { id: string; label: string }
      export interface LoadMoreState { hasMore: boolean }
      interface ButtonProps {
        variant: 'primary' | 'quiet'
        actions: readonly MenuAction[]
        more: LoadMoreState
        onPick: (action: MenuAction) => void
        children: ReactNode
      }
      export function Button({ variant }: ButtonProps) { return <button data-variant={variant} /> }
      export function useMenu(label: string) { return label }`
    put('packages/emcn/src/button/button.tsx', button)
    expect(run('--update').status).toBe(0)
    expect(run()).toEqual({ status: 0, output: expect.stringContaining('matches') })

    put(
      'packages/emcn/src/button/button.module.css',
      '.button {\n  color: red;\n  padding: 0  4px;\n}'
    )
    expect(run().status).toBe(0)

    put('packages/emcn/src/button/button.module.css', `${sheet} .loud { color: red }`)
    put(
      'packages/emcn/src/button/button.tsx',
      button
        .replace("'quiet'", "'quiet' | 'loud'")
        .replace('variant: ', 'className?: string; variant: ')
        .replace('label: string }', 'label: string; tone?: string }')
        .replace('hasMore: boolean', 'hasMore: boolean; onLoadMore: () => void')
        .replace('(action: MenuAction)', '(action: MenuAction, index: number)')
        .replace('useMenu(label: string)', 'useMenu(label: string, options?: { dense: boolean })')
        .concat('\nexport const Chip = () => null')
    )
    put('packages/emcn/src/styles/theme.css', `${theme}\n.chip-row { --emcn-gap: 4px }`)
    let result = run()
    expect(result.status).toBe(1)
    for (const line of [
      '+ @sim/emcn › classes › src/button/button.module.css › loud',
      '+ @sim/emcn › exports › ./button › names › Chip',
      '+ @sim/emcn › exports › ./button › props › Button › className',
      '+ @sim/emcn › exports › ./button › props › Button › variant › loud',
      '+ @sim/emcn › exports › ./button › props › Button › actions › [] › tone',
      '+ @sim/emcn › exports › ./button › props › Button › more › onLoadMore',
      '+ @sim/emcn › exports › ./button › props › Button › onPick › () › index',
      '+ @sim/emcn › exports › ./button › params › useMenu › options',
      '+ @sim/emcn › exports › ./styles/theme.css › properties › --emcn-gap',
      '+ @sim/emcn › exports › ./styles/theme.css › selectors › .chip-row',
    ])
      expect(result.output).toContain(line)
    expect(result.output).toContain('Only the design owner')

    put('packages/emcn/src/button/button.tsx', button)
    put('packages/emcn/src/styles/theme.css', theme)
    put('packages/emcn/src/button/button.module.css', sheet.replace('red', 'blue'))
    result = run()
    expect(result.status).toBe(1)
    expect(result.output).toContain('~ @sim/emcn › classes › src/button/button.module.css › button')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
