#!/usr/bin/env node

/**
 * Build Standalone App Script
 *
 * This script builds a standalone version of Sim Studio that can be run without a database.
 * It creates a tarball that includes:
 * 1. A pre-built Next.js application
 * 2. A simple Express server to serve the application
 * 3. Configuration to use browser localStorage for data persistence
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const tar = require('tar')
const crypto = require('crypto')

// Configuration
const ROOT_DIR = path.resolve(__dirname, '..')
const STANDALONE_DIR = path.join(ROOT_DIR, 'packages/simstudio/standalone')
const STANDALONE_PACKAGE_JSON = path.join(STANDALONE_DIR, 'package.json')
const STANDALONE_SERVER_JS = path.join(STANDALONE_DIR, 'server.js')
const OUTPUT_TARBALL = path.join(ROOT_DIR, 'sim-standalone.tar.gz')

// Ensure the standalone directory exists
if (!fs.existsSync(STANDALONE_DIR)) {
  fs.mkdirSync(STANDALONE_DIR, { recursive: true })
}

// Clean the standalone directory first
if (fs.existsSync(STANDALONE_DIR)) {
  fs.rmSync(STANDALONE_DIR, { recursive: true, force: true })
}
fs.mkdirSync(STANDALONE_DIR, { recursive: true })

// Build the Next.js app with local storage mode
console.log('Building Next.js app in standalone mode...')
try {
  // Instead of using static export, we'll build a regular Next.js app
  // and then copy the necessary files to run it with a simple Express server
  execSync('npm run build', {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      USE_LOCAL_STORAGE: 'true',
      NEXT_PUBLIC_USE_LOCAL_STORAGE: 'true',
      DISABLE_DB_SYNC: 'true',
      NODE_ENV: 'production',
    },
  })
} catch (error) {
  console.error('Failed to build Next.js app:', error)
  console.log('Continuing with the standalone build process...')
}

// Copy the built app to the standalone directory
console.log('Copying built app to standalone directory...')
try {
  // Copy the .next directory
  if (fs.existsSync(path.join(ROOT_DIR, '.next'))) {
    execSync(`cp -r ${path.join(ROOT_DIR, '.next')} ${path.join(STANDALONE_DIR, '.next')}`)
  }

  // Copy the public directory
  if (fs.existsSync(path.join(ROOT_DIR, 'public'))) {
    execSync(`cp -r ${path.join(ROOT_DIR, 'public')} ${path.join(STANDALONE_DIR, 'public')}`)
  }

  // Copy necessary files for standalone operation
  if (fs.existsSync(path.join(ROOT_DIR, 'next.config.ts'))) {
    execSync(
      `cp ${path.join(ROOT_DIR, 'next.config.ts')} ${path.join(STANDALONE_DIR, 'next.config.ts')}`
    )
  }
} catch (error) {
  console.error('Failed to copy built app:', error)
  process.exit(1)
}

// Create a package.json for the standalone app
console.log('Creating package.json for standalone app...')
const packageJson = {
  name: 'sim-studio-standalone',
  version: '0.1.0',
  private: true,
  scripts: {
    start: 'node server.js',
  },
  dependencies: {
    express: '^4.18.2',
    next: '^15.2.0',
    react: '^18.2.0',
    'react-dom': '^18.2.0',
    compression: '^1.7.4',
    'serve-favicon': '^2.5.0',
    typescript: '^5.7.3',
  },
}

fs.writeFileSync(STANDALONE_PACKAGE_JSON, JSON.stringify(packageJson, null, 2))

// Create a simple Express server to serve the static files
console.log('Creating server.js for standalone app...')
const serverJs = `
const express = require('express');
const next = require('next');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const favicon = require('serve-favicon');
const crypto = require('crypto');

// Register TypeScript compiler
require('typescript');

// Set environment variables for standalone mode
process.env.USE_LOCAL_STORAGE = 'true';
process.env.NEXT_PUBLIC_USE_LOCAL_STORAGE = 'true';
process.env.DISABLE_DB_SYNC = 'true';
process.env.DISABLE_AUTH = 'true';
process.env.NEXT_PUBLIC_DISABLE_AUTH = 'true';

const port = process.env.SIM_STUDIO_PORT || 3000;
const dev = false; // Always run in production mode

// Initialize Next.js
const app = next({ dev, dir: __dirname });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = express();
  
  // Enable compression
  server.use(compression());
  
  // Serve favicon
  if (fs.existsSync(path.join(__dirname, 'public', 'favicon.ico'))) {
    server.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
  }
  
  // Middleware to set environment variables for each request
  server.use((req, res, next) => {
    // These will be available to the API routes
    process.env.USE_LOCAL_STORAGE = 'true';
    process.env.NEXT_PUBLIC_USE_LOCAL_STORAGE = 'true';
    process.env.DISABLE_DB_SYNC = 'true';
    process.env.DISABLE_AUTH = 'true';
    process.env.NEXT_PUBLIC_DISABLE_AUTH = 'true';
    next();
  });

  // Redirect root path to a new workflow
  server.get('/', (req, res) => {
    // Generate a UUID for the new workflow
    const uuid = crypto.randomUUID();
    console.log(\`Redirecting to new workflow: \${uuid}\`);
    res.redirect(\`/w/\${uuid}\`);
  });

  // Handle all other requests with Next.js
  server.all('*', (req, res) => {
    return handle(req, res);
  });

  // Start the server
  server.listen(port, (err) => {
    if (err) throw err;
    console.log(\`> Sim Studio standalone server ready on http://localhost:\${port}\`);
    console.log('> Running in local storage mode - all data will be stored in the browser');
    console.log('> Authentication is disabled - anyone can access the app');
  });
});
`

fs.writeFileSync(STANDALONE_SERVER_JS, serverJs)

// Skip creating .env file for the standalone app
console.log('Skipping .env file creation for standalone app...')

// Create a tsconfig.json for the standalone app
console.log('Creating tsconfig.json for standalone app...')
const tsconfigJson = {
  compilerOptions: {
    target: 'es5',
    lib: ['dom', 'dom.iterable', 'esnext'],
    allowJs: true,
    skipLibCheck: true,
    strict: true,
    forceConsistentCasingInFileNames: true,
    noEmit: true,
    esModuleInterop: true,
    module: 'esnext',
    moduleResolution: 'node',
    resolveJsonModule: true,
    isolatedModules: true,
    jsx: 'preserve',
    incremental: true,
    plugins: [
      {
        name: 'next',
      },
    ],
    paths: {
      '@/*': ['./*'],
    },
  },
  include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
  exclude: ['node_modules'],
}

fs.writeFileSync(path.join(STANDALONE_DIR, 'tsconfig.json'), JSON.stringify(tsconfigJson, null, 2))

// Create a README.md for the standalone app
console.log('Creating README.md for standalone app...')
const readmeFile = `# Sim Studio Standalone

This is a standalone version of Sim Studio that runs without a database. All data is stored in your browser's localStorage.

## Getting Started

1. Install dependencies:
   \`\`\`
   npm install
   \`\`\`

2. Start the server:
   \`\`\`
   npm start
   \`\`\`

3. Open your browser to http://localhost:3000

## Features

- **Full Functionality**: All features of Sim Studio are available, including API routes
- **No Authentication Required**: Just start building workflows right away
- **Local Storage**: All your workflows and settings are stored in your browser's localStorage
- **Drag and Drop Interface**: Easily create and connect workflow blocks
- **Real-time Execution**: Test your workflows as you build them

## Environment Variables

You can customize the app by setting these environment variables:

- \`SIM_STUDIO_PORT\`: Change the port (default: 3000)

## How It Works

When you start the app, it will:
1. Automatically redirect you to a new workflow with a unique ID
2. Allow you to drag and drop blocks to build your workflow
3. Save all your work to localStorage in your browser
4. Let you execute workflows directly in the browser

No database or authentication is required!
`

fs.writeFileSync(path.join(STANDALONE_DIR, 'README.md'), readmeFile)

// Create the tarball
console.log('Creating tarball...')
try {
  // Remove any .env files before creating the tarball
  console.log('Removing any .env files from the standalone directory...')
  execSync('find ' + STANDALONE_DIR + ' -name ".env*" -type f -delete')

  // Create the tarball
  execSync(
    `tar -czf ${OUTPUT_TARBALL} -C ${path.dirname(STANDALONE_DIR)} ${path.basename(STANDALONE_DIR)}`
  )
  console.log(`Standalone app built and packaged to ${OUTPUT_TARBALL}`)
  console.log('You can now upload this file to GitHub releases')
} catch (error) {
  console.error('Failed to create tarball:', error)
  process.exit(1)
}
