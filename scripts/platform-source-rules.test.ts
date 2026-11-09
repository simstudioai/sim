import ts from '@typescript/typescript6'
import { describe, expect, it } from 'vitest'
import {
  classifyPage,
  hasAsciiEllipsis,
  inFixtureBranch,
  isFixtureModeBranch,
  isUnownedLoadFailure,
} from './platform-source-rules'

const parse = (source: string) =>
  ts.createSourceFile('view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

/** Whether `predicate` holds for any node of `source`. */
function anyNode(source: string, predicate: (node: ts.Node) => boolean) {
  let found = false
  const visit = (node: ts.Node) => {
    found ||= predicate(node)
    ts.forEachChild(node, visit)
  }
  visit(parse(source))
  return found
}

describe('classifyPage', () => {
  it.each([
    [
      'fixture-branch',
      `export default async function Page() {
        if (process.env.SIM_PLATFORM_FIXTURES === '1') return <Fixture />
        return <Live />
      }`,
    ],
    [
      'live-only',
      `export default async function Page() {
        if (resolvePlatformMode() !== 'live') notFound()
        return <Live />
      }`,
    ],
    [
      'redirect-only',
      `export default async function Page() {
        if (resolvePlatformMode() !== 'live') notFound()
        return redirectLegacyWorkspaceUrl('w', [], {})
      }`,
    ],
    ['unclassified', 'export default function Page() { return <Live /> }'],
    ['unclassified', `export default function Page() { redirect('/x'); return <Live /> }`],
  ])('reads %s', (kind, source) => {
    expect(classifyPage(parse(source))).toBe(kind)
  })
})

describe('isFixtureModeBranch', () => {
  it.each([
    `const live = process.env.SIM_PLATFORM_FIXTURES !== '1'`,
    'if (fixture) save()',
    'const label = !props.fixture ? a : b',
    'const off = fixture || pending',
    `const mode = resolvePlatformMode()`,
  ])('flags %s', (source) => {
    expect(anyNode(source, isFixtureModeBranch)).toBe(true)
  })

  it.each([
    'const view = <Section fixture={fixture} />',
    'const { fixture } = props',
    'const flag = props.fixture',
  ])('passes %s', (source) => {
    expect(anyNode(source, isFixtureModeBranch)).toBe(false)
  })
})

describe('inFixtureBranch', () => {
  const importIn = (source: string) =>
    anyNode(
      source,
      (node) =>
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        inFixtureBranch(node)
    )

  it('holds for an import the fixture build branch makes, and nowhere else', () => {
    expect(
      importIn(`if (process.env.SIM_PLATFORM_FIXTURES === '1') { await import('./fixtures') }`)
    ).toBe(true)
    expect(
      importIn(
        `if (process.env.SIM_PLATFORM_FIXTURES === '1') {} else { await import('./fixtures') }`
      )
    ).toBe(false)
    expect(
      importIn(`if (resolvePlatformMode() === 'fixture') { await import('./fixtures') }`)
    ).toBe(false)
    expect(importIn(`await import('./fixtures')`)).toBe(false)
  })
})

describe('isUnownedLoadFailure', () => {
  it.each([
    `const view = <p>Couldn't load rows</p>`,
    `const view = <Empty title='Could not load this file' />`,
    `const view = <p>{failed ? 'Failed to fetch members' : 'Members'}</p>`,
  ])('flags %s', (source) => {
    expect(anyNode(source, isUnownedLoadFailure)).toBe(true)
  })

  it.each([
    `const view = <FailureNotice message="Couldn't load rows" onRetry={retry} />`,
    `const view = <QueryFailure message='Could not load members' query={query} />`,
    `const message = () => "Couldn't load rows"`,
    `toast.error("Couldn't save")`,
  ])('passes %s', (source) => {
    expect(anyNode(source, isUnownedLoadFailure)).toBe(false)
  })
})

describe('hasAsciiEllipsis', () => {
  it.each([
    `const view = <SearchField placeholder='Search links...' />`,
    'const view = <p>Leaving...</p>',
    `const label = () => 'Deleting...'`,
  ])('flags %s', (source) => {
    expect(anyNode(source, hasAsciiEllipsis)).toBe(true)
  })

  it.each([
    `const view = <SearchField placeholder='Search links…' />`,
    'const view = <Row {...props} />',
    `const pattern = 'a...b'.split('.')`,
  ])('passes %s', (source) => {
    expect(anyNode(source, hasAsciiEllipsis)).toBe(false)
  })
})
