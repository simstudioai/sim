import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import postcss from 'postcss'
import loadPostcssConfig from 'postcss-load-config'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const origin = new URL(process.env.SIM_EXTENSION_ORIGIN ?? 'https://www.sim.ai')
const development = process.env.SIM_EXTENSION_DEV === '1'
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
if (
  origin.username ||
  origin.password ||
  origin.pathname !== '/' ||
  origin.search ||
  origin.hash ||
  (origin.protocol !== 'https:' && !(development && loopback && origin.protocol === 'http:'))
) {
  throw new Error(
    'SIM_EXTENSION_ORIGIN must be an HTTPS origin; explicit development builds may use HTTP loopback.'
  )
}
const key = process.env.SIM_EXTENSION_KEY
if (key && (!/^[A-Za-z0-9+/]+={0,2}$/.test(key) || key.length > 4_096))
  throw new Error('SIM_EXTENSION_KEY must be a base64 public key.')

const dist = resolve(root, 'dist')
await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: { background: 'src/background.ts', sidepanel: 'src/sidepanel.tsx' },
  outdir: dist,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  minify: !development,
  sourcemap: development ? 'external' : false,
  tsconfig: resolve(root, 'tsconfig.json'),
  loader: { '.module.css': 'local-css', '.woff2': 'file' },
  define: {
    __SIM_ORIGIN__: JSON.stringify(origin.origin),
    'process.env.NODE_ENV': '"production"',
    'process.env': '{}',
    'globalThis.process': 'undefined',
  },
  plugins: [
    {
      name: 'extension-tailwind',
      setup(builder) {
        builder.onResolve({ filter: /SeasonSansUprightsVF\.woff2$/ }, () => ({
          path: resolve(root, '../sim/app/_styles/fonts/season/SeasonSansUprightsVF.woff2'),
        }))
        builder.onLoad({ filter: /shell\.css$/ }, async ({ path }) => {
          const config = await loadPostcssConfig({}, resolve(root, '../sim'))
          const result = await postcss(config.plugins).process(await readFile(path, 'utf8'), {
            from: path,
          })
          return { contents: result.css, loader: 'css', resolveDir: dirname(path) }
        })
      },
    },
  ],
})
await cp(resolve(root, 'src/sidepanel.html'), resolve(dist, 'sidepanel.html'))
for (const [size, file] of [
  [16, 'favicon-16x16.png'],
  [32, 'favicon-32x32.png'],
  [128, 'android-chrome-512x512.png'],
] as const) {
  await cp(resolve(root, '../sim/public/favicon', file), resolve(dist, `icon-${size}.png`))
}
await writeFile(
  resolve(dist, 'manifest.json'),
  JSON.stringify(
    {
      manifest_version: 3,
      name: development ? 'Sim (Development)' : 'Sim',
      version: '0.1.0',
      description:
        'Ask Sim about the page you are reading, with your existing Sim conversations and tools.',
      minimum_chrome_version: '120',
      permissions: ['activeTab', 'scripting', 'sidePanel', 'storage', 'contextMenus'],
      host_permissions: [`${origin.origin}/*`],
      optional_host_permissions: ['https://*/*', 'http://*/*'],
      background: { service_worker: 'background.js' },
      side_panel: { default_path: 'sidepanel.html' },
      action: { default_title: 'Open Sim' },
      icons: { 16: 'icon-16.png', 32: 'icon-32.png', 128: 'icon-128.png' },
      commands: {
        'open-sim': {
          suggested_key: { default: 'Alt+Shift+S', mac: 'Command+Shift+S' },
          description: 'Open Sim and attach the current page',
        },
      },
      content_security_policy: {
        extension_pages: `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; frame-src ${origin.origin}; connect-src 'none'; object-src 'none'; base-uri 'none'`,
      },
      incognito: 'not_allowed',
      ...(key ? { key } : {}),
    },
    null,
    2
  )
)
