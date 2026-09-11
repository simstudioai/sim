import { expect, it } from 'vitest'
import { compareFiles } from '#design-diff/tests/helpers'

it.each([
  ['apps/docs/content/a.mdx', '<Card title="First" />', '<Card title="Second" />'],
  [
    'apps/desktop/src/renderer/index.html',
    '<!doctype html><p style="color:red">Hello</p>',
    '<!doctype html><p style="color:blue">Hello</p>',
  ],
  [
    'apps/sim/components/button.css',
    '@media(min-width:600px){button{color:red!important}}',
    '@media(min-width:800px){button{color:red!important}}',
  ],
  [
    'apps/sim/components/button.css',
    '@keyframes fade{from{opacity:0}to{opacity:1}}',
    '@keyframes fade{from{opacity:0.5}to{opacity:1}}',
  ],
  [
    'apps/desktop/src/main/window.ts',
    'new BrowserWindow({width:800,backgroundColor:"red"})',
    'new BrowserWindow({width:800,backgroundColor:"blue"})',
  ],
  [
    'apps/sim/app/a.tsx',
    'export const A=()=> <div dangerouslySetInnerHTML={{__html:"<b>One</b>"}}/>',
    'export const A=()=> <div dangerouslySetInnerHTML={{__html:"<b>Two</b>"}}/>',
  ],
  ['apps/desktop/src/renderer/a.js', 'node.innerHTML="Hello"', 'node.innerHTML="Welcome"'],
  ['tailwind.config.js', 'export default {plugins:[]}', 'export default {plugins:[customPlugin]}'],
  [
    'apps/desktop/src/main/window.ts',
    'win.setBackgroundColor("red")',
    'win.setBackgroundColor("blue")',
  ],
  [
    'apps/desktop/src/main/window.ts',
    'nativeTheme.themeSource="light"',
    'nativeTheme.themeSource="dark"',
  ],
  [
    'apps/desktop/src/main/terminal-themes.ts',
    'const script = "foreground:red"',
    'const script = "foreground:blue"',
  ],
])('covers %s', async (file, before, after) => {
  const report = await compareFiles({ [file]: before }, { [file]: after })
  expect(report.flagged).toBe(true)
})

it('preserves declaration and selector precedence', async () => {
  const file = 'apps/sim/a.css'
  const report = await compareFiles(
    { [file]: '.a {color:red}.a {color:blue}' },
    { [file]: '.a {color:blue}.a {color:red}' }
  )
  expect(report.flagged).toBe(true)
})

it('ignores CSS comments and formatting', async () => {
  const file = 'apps/sim/a.css'
  const report = await compareFiles(
    { [file]: '.a{color:red}' },
    { [file]: '/** comment */\n.a {\n color: red;\n}' }
  )
  expect(report.flagged).toBe(false)
})

it('keeps meaningful HTML preformatted whitespace', async () => {
  const file = 'apps/desktop/a.html'
  const report = await compareFiles({ [file]: '<pre> a b </pre>' }, { [file]: '<pre> a  b </pre>' })
  expect(report.flagged).toBe(true)
})
