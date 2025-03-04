#!/usr/bin/env node

// This file is the entry point for the 'sim' command
try {
  require('../dist/index.js')
} catch (error) {
  if (error.code === 'MODULE_NOT_FOUND') {
    console.error('Sim CLI has not been built. Please run npm run build first.')
    process.exit(1)
  } else {
    console.error('An error occurred while starting Sim CLI:', error)
    process.exit(1)
  }
}
