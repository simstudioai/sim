import ts from '@typescript/typescript6'
import { describe, expect, it } from 'vitest'
import {
  classifyPage,
  echoesNoResultsQuery,
  handRole,
  hasAsciiEllipsis,
  inFixtureBranch,
  isFixtureModeBranch,
  isHandBack,
  isHandConfirm,
  isNativeTitle,
  isUnownedLoadFailure,
  titleCaseWords,
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

describe('isHandConfirm', () => {
  it.each([
    `const view = <Modal variant='confirm' title='Delete link' />`,
    `const view = <Modal open variant="confirm" title='Delete link'>body</Modal>`,
  ])('flags %s', (source) => {
    expect(anyNode(source, isHandConfirm)).toBe(true)
  })

  it.each([
    `const view = <Modal title='Rename file' />`,
    `const view = <Modal variant='feedback' title='Copied' />`,
    `const view = <ConfirmDialog target={x} title='Delete link' />`,
  ])('passes %s', (source) => {
    expect(anyNode(source, isHandConfirm)).toBe(false)
  })
})

describe('titleCaseWords', () => {
  const found = (source: string) => {
    const words: string[] = []
    const visit = (node: ts.Node) => {
      words.push(...titleCaseWords(node))
      ts.forEachChild(node, visit)
    }
    visit(parse(source))
    return words
  }

  it.each([
    [`const view = <Modal title='Delete Custom Tool' />`, ['Custom', 'Tool']],
    [`const view = <Button>Add Block</Button>`, ['Block']],
    [`const view = <MenuItem>Fit to View</MenuItem>`, ['View']],
    [`const view = <Modal title={\`Delete \${n} Columns\`} />`, ['Columns']],
    [`const items = [{ id: 'updated', label: 'Last Updated' }]`, ['Updated']],
    [`const view = <ConfirmDialog confirmLabel='Discard Changes' />`, ['Changes']],
    [`const view = <Tab label={open ? 'Switch to Runs' : 'Runs'} />`, ['Runs']],
    [`const view = <Modal title='Single Sign-On is available' />`, ['Sign', 'On']],
    [`const view = <Row label='Open in Logs' />`, ['Logs']],
    [`const view = <Capabilities deleteLabel='Remove from Skills' />`, ['Skills']],
    [`const actions = { createLabel: 'Add to Skills' }`, ['Skills']],
    [`const view = <Menu.Item>Customize Dashboard</Menu.Item>`, ['Dashboard']],
  ])('flags %s', (source, words) => {
    expect(found(source)).toEqual(words)
  })

  it.each([
    `const view = <Modal title='Delete API key' />`,
    `const view = <Button>Connect Slack</Button>`,
    `const view = <Modal title='Require SSO for Sim' />`,
    `const view = <Row label='Sign in with GitHub' />`,
    `const view = <p>Welcome back. Your Workspace is ready.</p>`,
    `const view = <Modal title='Delete “Q3 Plan”' />`,
    `const fixture = { title: 'Quarterly Planning Review' }`,
    `const view = <Modal title={name} />`,
    `const view = <Row label='Search: Recent' />`,
    `const view = <Row label='Install the GitHub App' />`,
    `const view = <Import helpLabel='Open Graph Explorer' />`,
    `const view = <Row label={\`\${name} · Admin\`} />`,
    `const view = <Button>Upgrade to Max</Button>`,
    `const view = <Menu.Item>Customize Home</Menu.Item>`,
    `const view = <Modal title='Create a Wiki page' />`,
  ])('passes %s', (source) => {
    expect(found(source)).toEqual([])
  })
})

describe('echoesNoResultsQuery', () => {
  it.each([
    `const view = <EmptyState title={\`No matching links for “\${term}”\`} />`,
    `const view = <Muted>No matching members for “{search}”</Muted>`,
    `const note = 'No matching options found'`,
    `const view = <EmptyState title={\`No tools found matching "\${search}"\`} />`,
    `const title = \`No results for “\${term}”\``,
  ])('flags %s', (source) => {
    expect(anyNode(source, echoesNoResultsQuery)).toBe(true)
  })

  it.each([
    `const view = <EmptyState title='No matching links' />`,
    `const view = <Muted>No matching members</Muted>`,
    `const title = \`No matching \${noun}\``,
    `const view = <EmptyState title='No links yet' />`,
  ])('passes %s', (source) => {
    expect(anyNode(source, echoesNoResultsQuery)).toBe(false)
  })
})

describe('hasAsciiEllipsis in labels', () => {
  it.each([
    `const STATUS = { running: { label: 'Running...' } }`,
    `const LABELS: Record<string, string> = { queued: 'Waiting...' }`,
  ])('flags %s', (source) => {
    expect(anyNode(source, hasAsciiEllipsis)).toBe(true)
  })

  it.each([`const parts = { pattern: '...' }`, `const range = { text: 'a...b'.length }`])(
    'passes %s',
    (source) => {
      expect(anyNode(source, hasAsciiEllipsis)).toBe(false)
    }
  )
})

describe('isHandBack', () => {
  it.each([
    `const view = <Button variant='quiet' icon='I093' onClick={back}>Back to people</Button>`,
    `const view = <Button icon='I140' onClick={back}>Logs</Button>`,
  ])('flags %s', (source) => {
    expect(anyNode(source, isHandBack)).toBe(true)
  })

  it.each([
    `const view = <IconButton label='Back' icon='I093' onClick={history.back} />`,
    `const view = <Button icon='I061' onClick={remove}>Delete</Button>`,
    `const view = <DirectoryBack href='/x' label='Skills' />`,
  ])('passes %s', (source) => {
    expect(anyNode(source, isHandBack)).toBe(false)
  })
})

describe('handRole', () => {
  const roles = (source: string) => {
    const found: string[] = []
    const visit = (node: ts.Node) => {
      const role = handRole(node)
      if (role) found.push(role)
      ts.forEachChild(node, visit)
    }
    visit(parse(source))
    return found
  }

  it('names a hand-built tab, tab list or alert', () => {
    expect(
      roles(`const view = <div role='tablist'><button role='tab' /><p role="alert">x</p></div>`)
    ).toEqual(['tablist', 'tab', 'alert'])
  })

  it('passes other roles and computed ones', () => {
    expect(
      roles(`const view = <div role='tabpanel'><p role='status' /><p role={role} /></div>`)
    ).toEqual([])
  })
})

describe('isNativeTitle', () => {
  it.each([
    `const view = <span title={name}>{name}</span>`,
    `const view = <button title='Approve'>Approve</button>`,
  ])('flags %s', (source) => {
    expect(anyNode(source, isNativeTitle)).toBe(true)
  })

  it.each([
    `const view = <Tooltip title='Approve' />`,
    `const view = <iframe title='Preview' src={url} />`,
    `const view = <svg><title>Chart</title></svg>`,
  ])('passes %s', (source) => {
    expect(anyNode(source, isNativeTitle)).toBe(false)
  })
})
