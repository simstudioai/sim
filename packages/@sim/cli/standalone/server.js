#!/usr/bin/env node

/**
 * Sim Studio Standalone Server
 *
 * This is a simplified server that serves the pre-built Sim Studio app
 * and enables localStorage mode automatically.
 */

const express = require('express')
const path = require('path')
const fs = require('fs')
const { createServer } = require('http')
const { parse } = require('url')

// Configuration
const PORT = process.env.SIM_STUDIO_PORT || 3000
const PUBLIC_DIR = path.join(__dirname, 'public')
const HTML_FILE = path.join(PUBLIC_DIR, 'index.html')

// Create Express app
const app = express()

// Set localStorage environment variable in HTML
const injectLocalStorageScript = (html) => {
  const script = `
    <script>
      // Set localStorage flag for Sim Studio
      localStorage.setItem('USE_LOCAL_STORAGE', 'true');
      console.log('Sim Studio running in local storage mode');
    </script>
  `

  // Insert script right before the closing </head> tag
  return html.replace('</head>', `${script}</head>`)
}

// Middleware to inject localStorage flag
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    const originalSend = res.send
    res.send = function (body) {
      if (typeof body === 'string' && body.includes('</head>')) {
        body = injectLocalStorageScript(body)
      }
      return originalSend.call(this, body)
    }
  }
  next()
})

// Serve static files
app.use(express.static(PUBLIC_DIR))

// SPA fallback - all routes not matched should serve index.html
app.get('*', (req, res) => {
  res.sendFile(HTML_FILE)
})

// Start the server
app.listen(PORT, () => {
  console.log(`
┌────────────────────────────────────────────────────┐
│                                                    │
│   🚀 Sim Studio is running in standalone mode!     │
│                                                    │
│   🌐 Local:  http://localhost:${PORT}                ${PORT.toString().length < 4 ? ' ' : ''}│
│                                                    │
│   💾 Using localStorage for all data               │
│   🔄 All changes will be saved in your browser     │
│                                                    │
│   Press Ctrl+C to stop the server                  │
│                                                    │
└────────────────────────────────────────────────────┘
`)
})
