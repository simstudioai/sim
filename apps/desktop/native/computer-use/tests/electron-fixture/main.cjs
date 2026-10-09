/** Offline Electron acceptance fixture. No production origin, network, or user profile is used. */
const { app, BrowserWindow, ipcMain, Menu, session } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

const output = process.env.MSHIP_COMPOSER_FIXTURE_OUTPUT
if (!output) throw new Error('MSHIP_COMPOSER_FIXTURE_OUTPUT is required')
mkdirSync(output, { recursive: true })
app.setPath('userData', join(output, 'profile'))
app.setName('Mothership Composer Fixture')
app.commandLine.appendSwitch('force-renderer-accessibility')
const pageURL = pathToFileURL(resolve(__dirname, 'index.html')).href
let window

app.whenReady().then(async () => {
  app.setAccessibilitySupportEnabled(true)
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('data:') })
  })
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'Fixture', submenu: [{ role: 'quit' }] },
      {
        label: 'Large fixture menu',
        submenu: Array.from({ length: 350 }, (_, index) => ({ label: `Fixture command ${index}` })),
      },
      { label: 'Edit', submenu: [{ role: 'selectAll' }, { role: 'copy' }, { role: 'paste' }] },
    ])
  )
  window = new BrowserWindow({
    width: 1040,
    height: 760,
    show: false,
    title: 'Mothership Composer Fixture — local only',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== pageURL) event.preventDefault()
  })
  ipcMain.on('fixture:state', (event, state) => {
    if (event.sender !== window.webContents || event.senderFrame.url !== pageURL) return
    writeFileSync(
      join(output, 'state.json'),
      JSON.stringify({
        ...state,
        windowBounds: window.getBounds(),
        contentBounds: window.getContentBounds(),
        pid: process.pid,
      }),
      { mode: 0o600 }
    )
  })
  await window.loadURL(pageURL)
  window.showInactive()
})
app.on('window-all-closed', () => app.quit())
