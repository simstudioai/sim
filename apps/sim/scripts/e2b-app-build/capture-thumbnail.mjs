#!/usr/bin/env node

import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, relative, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import sharp from 'sharp'

const VIEWPORT = { width: 1280, height: 800 }
const OUTPUT_NAME = 'preview.webp'
const CAPTURE_TIMEOUT_MS = 20_000
const FIXED_TIME_MS = Date.UTC(2026, 0, 1, 12, 0, 0)

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

function isContained(root, candidate) {
  const rel = relative(root, candidate)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep)
}

async function existingFile(path) {
  try {
    const info = await stat(path)
    return info.isFile() ? path : null
  } catch {
    return null
  }
}

async function resolveRequestFile(distRoot, requestUrl) {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(requestUrl || '/', 'http://localhost').pathname)
  } catch {
    return null
  }

  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const candidate = resolve(distRoot, requested)
  if (!isContained(distRoot, candidate)) return null

  const direct = await existingFile(candidate)
  if (direct) return direct

  // Match Apps Host's SPA fallback without turning missing assets into HTML.
  if (!extname(requested)) return existingFile(resolve(distRoot, 'index.html'))
  return null
}

async function startStaticServer(distRoot) {
  const server = createServer(async (request, response) => {
    try {
      const filePath = await resolveRequestFile(distRoot, request.url)
      if (!filePath) {
        response.writeHead(404, { 'cache-control': 'no-store' })
        response.end()
        return
      }

      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type':
          CONTENT_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
        'x-content-type-options': 'nosniff',
      })
      createReadStream(filePath).pipe(response)
    } catch {
      response.writeHead(500, { 'cache-control': 'no-store' })
      response.end()
    }
  })

  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to bind thumbnail server')
  return { server, origin: `http://127.0.0.1:${address.port}` }
}

async function closeServer(server) {
  await new Promise((resolvePromise) => server.close(() => resolvePromise()))
}

async function launchBrowser() {
  const options = {
    headless: true,
    args: [
      '--disable-background-networking',
      '--disable-breakpad',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-features=Translate,MediaRouter',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-first-run',
    ],
  }
  try {
    return await chromium.launch(options)
  } catch (bundledError) {
    // Trusted local builds may have system Chrome but no Playwright browser cache.
    try {
      return await chromium.launch({ ...options, channel: 'chrome' })
    } catch {
      throw bundledError
    }
  }
}

async function capture(distRoot) {
  const indexPath = resolve(distRoot, 'index.html')
  await access(indexPath)

  const { server, origin } = await startStaticServer(distRoot)
  let browser
  try {
    browser = await launchBrowser()
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: 'light',
      locale: 'en-US',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      timezoneId: 'UTC',
    })
    const page = await context.newPage()
    page.setDefaultTimeout(CAPTURE_TIMEOUT_MS)
    const runtimeErrors = []
    page.on('pageerror', (error) => {
      runtimeErrors.push(error instanceof Error ? error.message : String(error))
    })
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text())
    })

    // Keep generated code inside a local, credential-free rendering boundary.
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === origin) await route.continue()
      else await route.abort('blockedbyclient')
    })

    // Stable time/randomness reduces thumbnail churn for otherwise identical artifacts.
    await page.addInitScript(
      ({ fixedTime, parentOrigin }) => {
        globalThis.__SIM_PREVIEW__ = {
          channelNonce: 'thumbnail-capture',
          parentOrigin,
        }
        const NativeDate = Date
        class FixedDate extends NativeDate {
          constructor(...args) {
            super(...(args.length ? args : [fixedTime]))
          }
          static now() {
            return fixedTime
          }
        }
        globalThis.Date = FixedDate
        let seed = 0x5f3759df
        Math.random = () => {
          seed = (seed * 1664525 + 1013904223) >>> 0
          return seed / 0x100000000
        }
      },
      { fixedTime: FIXED_TIME_MS, parentOrigin: origin }
    )

    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: CAPTURE_TIMEOUT_MS })
    await page.addStyleTag({
      content:
        '*,*::before,*::after{animation:none!important;caret-color:transparent!important;transition:none!important}',
    })
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready
    })
    await page.waitForTimeout(500)
    const rendered = await page.evaluate(() => ({
      rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
      bodyText: document.body.innerText.trim(),
    }))
    if (rendered.rootChildren === 0) {
      const detail = runtimeErrors.length > 0 ? `: ${runtimeErrors.slice(0, 3).join(' | ')}` : ''
      throw new Error(`App did not render thumbnail content${detail}`)
    }
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false,
      animations: 'disabled',
      caret: 'hide',
    })
    await sharp(screenshot).webp({ quality: 78 }).toFile(resolve(distRoot, OUTPUT_NAME))
    await context.close()
  } finally {
    await browser?.close().catch(() => undefined)
    await closeServer(server).catch(() => undefined)
  }
}

const distArg = process.argv[2]
if (!distArg) {
  console.error('Usage: capture-thumbnail.mjs <dist-directory>')
  process.exit(2)
}

capture(resolve(distArg))
  .then(() => {
    console.log(JSON.stringify({ status: 'captured', file: OUTPUT_NAME, viewport: VIEWPORT }))
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
