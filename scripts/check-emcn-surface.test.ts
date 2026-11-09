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
          './button': { names: ['Button', 'ButtonProps'], props: { Button: { size: null } } },
          './chip': 'asset',
        },
      }
    )
  ).toEqual([
    '+ exports › ./button › names › ButtonProps',
    '~ exports › ./button › props › Button › size: ["md"] → null',
    '+ exports › ./chip',
  ])
})

it('fails when an export, prop, variant value or CSS Module class is added to EMCN', () => {
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
      JSON.stringify({ name: '@sim/emcn', exports: { './button': './src/button/button.tsx' } })
    )
    put('packages/emcn/src/button/button.module.css', '.button { color: red }')
    const button = `interface ButtonProps { variant: 'primary' | 'quiet' }
      export function Button({ variant }: ButtonProps) { return <button data-variant={variant} /> }`
    put('packages/emcn/src/button/button.tsx', button)
    expect(run('--update').status).toBe(0)
    expect(run()).toEqual({ status: 0, output: expect.stringContaining('matches') })

    put('packages/emcn/src/button/button.module.css', '.button { color: red } .loud { color: red }')
    put(
      'packages/emcn/src/button/button.tsx',
      button
        .replace("'quiet'", "'quiet' | 'loud'")
        .replace('variant: ', 'className?: string; variant: ')
        .concat('\nexport const Chip = () => null')
    )
    const result = run()
    expect(result.status).toBe(1)
    for (const line of [
      '+ @sim/emcn › classes › src/button/button.module.css › loud',
      '+ @sim/emcn › exports › ./button › names › Chip',
      '+ @sim/emcn › exports › ./button › props › Button › className',
      '+ @sim/emcn › exports › ./button › props › Button › variant › loud',
    ])
      expect(result.output).toContain(line)
    expect(result.output).toContain('Only the design owner')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
