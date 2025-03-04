#!/usr/bin/env node

/**
 * Build Standalone Distribution
 *
 * This script builds a standalone distribution of Sim Studio that can be downloaded
 * and run by the CLI with `npx sim`.
 *
 * The standalone package includes:
 * - Pre-built Next.js static export
 * - Simplified Express server
 * - Configured to use localStorage instead of a database
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const packageJson = require('../package.json')

// Configuration
const STANDALONE_DIR = path.join(__dirname, '../standalone-dist')
const SOURCE_DIR = path.join(__dirname, '..')
const OUTPUT_TARBALL = path.join(__dirname, '../sim-standalone.tar.gz')

console.log('🔨 Building Sim Studio standalone distribution')

// Clean up if the directory exists
if (fs.existsSync(STANDALONE_DIR)) {
  console.log('Cleaning up previous build...')
  fs.rmSync(STANDALONE_DIR, { recursive: true, force: true })
}

// Create standalone directory
fs.mkdirSync(STANDALONE_DIR, { recursive: true })
fs.mkdirSync(path.join(STANDALONE_DIR, 'public'), { recursive: true })

// Build Next.js static export
console.log('Building Next.js static export...')
try {
  // Set environment variable for static export with localStorage
  process.env.USE_LOCAL_STORAGE = 'true'
  process.env.NEXT_PUBLIC_USE_LOCAL_STORAGE = 'true'

  // Build the app
  execSync('npm run build', {
    cwd: SOURCE_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      USE_LOCAL_STORAGE: 'true',
      NEXT_PUBLIC_USE_LOCAL_STORAGE: 'true',
      NODE_ENV: 'production',
    },
  })

  // Copy the output to standalone directory
  console.log('Copying files to standalone directory...')
  fs.cpSync(path.join(SOURCE_DIR, 'out'), path.join(STANDALONE_DIR, 'public'), { recursive: true })
} catch (error) {
  console.error('Error building Next.js static export:', error)
  process.exit(1)
}

// Copy standalone server files
console.log('Copying standalone server files...')
fs.copyFileSync(
  path.join(SOURCE_DIR, 'packages/@sim/cli/standalone/server.js'),
  path.join(STANDALONE_DIR, 'server.js')
)
fs.copyFileSync(
  path.join(SOURCE_DIR, 'packages/@sim/cli/standalone/package.json'),
  path.join(STANDALONE_DIR, 'package.json')
)

// Create tarball
console.log('Creating tarball...')
try {
  execSync(`tar -czf "${OUTPUT_TARBALL}" -C "${STANDALONE_DIR}" .`, {
    stdio: 'inherit',
  })

  console.log(`✅ Standalone distribution created: ${OUTPUT_TARBALL}`)
  console.log(`📦 Size: ${(fs.statSync(OUTPUT_TARBALL).size / (1024 * 1024)).toFixed(2)} MB`)
} catch (error) {
  console.error('Error creating tarball:', error)
  process.exit(1)
}

console.log('\n🚀 Next steps:')
console.log('1. Upload the tarball to your release assets')
console.log('2. Update the DOWNLOAD_URL in the CLI code to point to your release')
console.log('3. Publish the CLI package to npm with: npm run cli:publish')
