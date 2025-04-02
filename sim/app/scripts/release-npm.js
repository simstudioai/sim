#!/usr/bin/env node

/**
 * Release NPM Package Script
 *
 * This script helps with the process of releasing the Sim Studio CLI to npm.
 * It builds the standalone app, prepares the CLI package, and publishes it to npm.
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// Configuration
const ROOT_DIR = path.resolve(__dirname, '..')
const CLI_DIR = path.join(ROOT_DIR, 'packages/@simstudio/cli')
const STANDALONE_DIR = path.join(CLI_DIR, 'standalone')
const OUTPUT_TARBALL = path.join(ROOT_DIR, 'sim-standalone.tar.gz')

// Ensure we're in the right directory
process.chdir(ROOT_DIR)

// Helper function to run commands and log output
function runCommand(command, options = {}) {
  console.log(`> ${command}`)
  try {
    execSync(command, {
      stdio: 'inherit',
      ...options,
    })
    return true
  } catch (error) {
    console.error(`Error running command: ${command}`)
    console.error(error)
    return false
  }
}

// Main release process
async function release() {
  console.log('=== Sim Studio CLI Release Process ===')

  // 1. Clean up any existing standalone files
  console.log('\n1. Cleaning up existing standalone files...')
  if (fs.existsSync(STANDALONE_DIR)) {
    fs.rmSync(STANDALONE_DIR, { recursive: true, force: true })
  }
  if (fs.existsSync(OUTPUT_TARBALL)) {
    fs.unlinkSync(OUTPUT_TARBALL)
  }

  // 2. Build the standalone app
  console.log('\n2. Building standalone app...')
  if (!runCommand('node scripts/build-standalone.js')) {
    console.error('Failed to build standalone app')
    process.exit(1)
  }

  // 3. Prepare the CLI package
  console.log('\n3. Preparing CLI package...')
  process.chdir(CLI_DIR)

  // Clean and build
  if (!runCommand('npm run clean && npm run build')) {
    console.error('Failed to build CLI package')
    process.exit(1)
  }

  // 4. Create the standalone directory
  console.log('\n4. Creating standalone directory...')
  if (!fs.existsSync(STANDALONE_DIR)) {
    fs.mkdirSync(STANDALONE_DIR, { recursive: true })
  }

  // 5. Publish to npm
  console.log('\n5. Publishing to npm...')
  console.log('Ready to publish to npm. Run the following commands:')
  console.log(`
  cd ${path.relative(process.cwd(), CLI_DIR)}
  npm publish
  `)

  // 6. Create GitHub release
  console.log('\n6. Creating GitHub release...')
  console.log('After publishing to npm, create a GitHub release with the standalone tarball:')
  console.log(`
  1. Go to https://github.com/simstudioai/sim/releases/new
  2. Set the tag to v0.1.0 (or your current version)
  3. Set the title to "Sim Studio v0.1.0"
  4. Upload the tarball: ${path.relative(ROOT_DIR, OUTPUT_TARBALL)}
  5. Publish the release
  `)

  console.log('\n=== Release Process Complete ===')
  console.log('Follow the instructions above to publish to npm and create a GitHub release.')
}

// Run the release process
release().catch((error) => {
  console.error('Release process failed:', error)
  process.exit(1)
})
