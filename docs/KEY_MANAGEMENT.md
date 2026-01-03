# Automated Key Management System

A secure, automated system for managing API keys and secrets across applications using a "find, store, inject, forget" workflow.

## Overview

The Key Management System automates the discovery, storage, and injection of API keys and secrets while maintaining security best practices. It integrates with GitHub Actions to provide seamless key management during build and deployment processes.

## Features

- **🔍 Automatic Discovery**: Scans application code to identify required environment variables
- **🔐 Secure Storage**: Stores keys in GitHub repository secrets with encryption
- **💉 Smart Injection**: Injects keys into the appropriate configuration files (.env, docker-compose, etc.)
- **🧹 Memory Management**: Automatically clears sensitive data after processing
- **🔄 Extensible**: Support for custom external key sources
- **📊 Comprehensive Logging**: Detailed operation logs without exposing sensitive values

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     GitHub Actions Workflow                  │
│                    (.github/workflows/key-manager.yml)       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Key Manager Script                        │
│                   (scripts/key-manager.ts)                   │
│                                                              │
│  1. Scan for required keys                                  │
│  2. Check GitHub secrets                                    │
│  3. Fetch missing keys (external sources)                   │
│  4. Store in GitHub secrets                                 │
│  5. Inject into config files                                │
│  6. Clear from memory                                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Configuration File                        │
│                  (key-manager.config.json)                   │
│                                                              │
│  • Required keys definitions                                │
│  • External source configuration                            │
│  • Injection target mappings                                │
│  • Security settings                                        │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Configuration

The system is configured via `key-manager.config.json` in the repository root. This file defines:

- **Required keys**: Which environment variables are needed
- **External sources**: Where to fetch missing keys
- **Injection targets**: Where keys should be placed (.env, docker-compose, etc.)
- **Security settings**: Masking, memory clearing, rotation policies

Example configuration:

```json
{
  "requiredKeys": [
    {
      "name": "DATABASE_URL",
      "description": "PostgreSQL database connection string",
      "pattern": "^postgresql://",
      "required": true,
      "inject": [".env", "docker-compose"]
    }
  ],
  "externalSources": [
    {
      "name": "keyfinder",
      "type": "api",
      "authSecret": "KEYFINDER_SECRET",
      "endpoint": "https://api.keyfinder.example.com/v1/keys"
    }
  ]
}
```

### 2. GitHub Secrets Setup

Add the following secrets to your GitHub repository:

1. **KEYFINDER_SECRET** (optional): Authentication token for external key sources
2. Any other service-specific secrets you want to manage

Go to: `Repository Settings → Secrets and variables → Actions → New repository secret`

### 3. Usage in Workflows

#### As a Reusable Workflow

Add to your existing CI/CD workflow:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      # ... your build steps ...

  manage-keys:
    name: Manage Keys
    needs: build
    uses: ./.github/workflows/key-manager.yml
    secrets: inherit
    with:
      command: 'scan'
      dry_run: false
```

#### Manual Trigger

You can also trigger the workflow manually from the GitHub Actions tab:

1. Go to `Actions → Key Management`
2. Click `Run workflow`
3. Select command (`scan`, `check`, or `inject`)
4. Choose whether to run in dry-run mode
5. Click `Run workflow`

### 4. Command Line Usage

You can also run the key manager script locally:

```bash
# Install dependencies
cd scripts
bun install

# Scan and manage keys (full workflow)
bunx tsx key-manager.ts scan

# Just check GitHub secrets
bunx tsx key-manager.ts check

# Inject keys from environment to files
bunx tsx key-manager.ts inject
```

**Environment variables required:**
- `GITHUB_TOKEN`: GitHub personal access token with repo and secrets permissions
- `GITHUB_REPOSITORY`: Format `owner/repo`
- `KEYFINDER_SECRET`: (optional) For external key fetching

## Commands

### `scan` (Default)

Runs the complete workflow:
1. Scans for required keys
2. Checks GitHub secrets
3. Fetches missing keys from external sources
4. Stores new keys in GitHub secrets
5. Injects keys into configuration files
6. Clears sensitive data from memory

```bash
bunx tsx key-manager.ts scan
```

### `check`

Only checks which keys exist in GitHub secrets without making changes:

```bash
bunx tsx key-manager.ts check
```

### `inject`

Injects keys from environment variables into configuration files:

```bash
bunx tsx key-manager.ts inject
```

## Configuration Reference

### Key Definition

```json
{
  "name": "API_KEY_NAME",
  "description": "Human-readable description",
  "pattern": "^regex_pattern$",  // Optional validation pattern
  "required": true,               // Whether key is required
  "inject": [".env", "docker-compose"]  // Where to inject
}
```

### External Sources

```json
{
  "name": "source_name",
  "type": "api",
  "description": "Source description",
  "authSecret": "GITHUB_SECRET_NAME",
  "endpoint": "https://api.example.com/keys"
}
```

### Injection Targets

```json
{
  ".env": {
    "path": ".env",
    "format": "dotenv",
    "template": ".env.example"
  },
  "docker-compose": {
    "path": "docker-compose.prod.yml",
    "format": "yaml",
    "section": "services.app.environment"
  }
}
```

## Security Best Practices

### 1. GitHub Secrets Masking

The system automatically uses GitHub's secret masking feature. Any value stored as a secret will be masked in logs.

### 2. Memory Clearing

After processing, all sensitive values are overwritten in memory and deleted.

### 3. No Logging of Secrets

The system never logs actual key values. Only key names and metadata are logged.

### 4. Limited Access

- Only repository owners and administrators can access GitHub secrets
- The `GITHUB_TOKEN` used by workflows has limited, scoped permissions
- External key fetching requires separate authentication

### 5. Key Rotation

Configure rotation warnings in the config:

```json
{
  "security": {
    "rotationWarningDays": 90
  }
}
```

## Troubleshooting

### Issue: "GITHUB_TOKEN environment variable is required"

**Solution**: Ensure the workflow has proper permissions:

```yaml
permissions:
  contents: read
  secrets: write
```

### Issue: Keys not found in GitHub secrets

**Solution**: 
- Verify secrets in `Repository Settings → Secrets and variables → Actions`
- Check you have admin access to the repository
- Ensure the GITHUB_TOKEN has `secrets: write` permission

### Issue: External key fetch failing

**Solution**:
- Add KEYFINDER_SECRET to repository secrets
- Check external service endpoint in config
- Verify authentication credentials

## Best Practices

1. **Start with dry-run mode**: Test changes with `dry_run: true` first
2. **Use templates**: Maintain `.env.example` as a template for new environments
3. **Regular audits**: Schedule weekly key audits with the `check` command
4. **Document keys**: Add clear descriptions in the config file
5. **Rotate regularly**: Set up rotation reminders for sensitive keys
6. **Limit access**: Only grant key access to necessary users and workflows
7. **Monitor usage**: Review workflow logs regularly

## License

This system is part of the Sim Studio project and follows the same license.

## Support

For issues, questions, or contributions:

- GitHub Issues: [al7566/sim/issues](https://github.com/al7566/sim/issues)
- Documentation: [docs.sim.ai](https://docs.sim.ai)
- Discord: [Join Server](https://discord.gg/Hr4UWYEcTT)
