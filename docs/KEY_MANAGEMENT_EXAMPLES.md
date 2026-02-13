# Example: Integrating Key Management with CI/CD

This example demonstrates how to integrate the automated key management system with your existing CI/CD workflow.

## Basic Integration

Add the key management workflow after your build step:

```yaml
name: CI

on:
  push:
    branches: [main, staging]

jobs:
  test-build:
    name: Test and Build
    uses: ./.github/workflows/test-build.yml
    secrets: inherit

  # Add key management after successful build
  manage-keys:
    name: Manage API Keys
    needs: test-build
    uses: ./.github/workflows/key-manager.yml
    secrets: inherit
    with:
      command: 'scan'
      dry_run: false

  # Deploy only after keys are ready
  deploy:
    name: Deploy Application
    needs: manage-keys
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to production
        run: |
          echo "Deploying with managed keys..."
          # Your deployment logic here
```

## Manual Key Audit

Run a weekly audit of your keys:

```yaml
name: Weekly Key Audit

on:
  schedule:
    - cron: '0 0 * * 0'  # Every Sunday at midnight

jobs:
  audit-keys:
    name: Audit Repository Keys
    uses: ./.github/workflows/key-manager.yml
    secrets: inherit
    with:
      command: 'check'
      dry_run: true
```

## Pre-Deployment Key Injection

Inject keys before deploying:

```yaml
name: Manual Deployment

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment'
        required: true
        type: choice
        options:
          - staging
          - production

jobs:
  prepare-keys:
    name: Prepare Keys
    uses: ./.github/workflows/key-manager.yml
    secrets: inherit
    with:
      command: 'inject'
      dry_run: false

  deploy:
    name: Deploy to ${{ inputs.environment }}
    needs: prepare-keys
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - uses: actions/checkout@v4
      - name: Deploy
        run: ./scripts/deploy.sh ${{ inputs.environment }}
```

## Local Development

Use the key manager locally during development:

```bash
# Set up your environment
export GITHUB_TOKEN="your_github_token"
export GITHUB_REPOSITORY="owner/repo"

# Check which keys exist
cd scripts
bunx tsx key-manager.ts check

# Inject keys from environment to .env file
export DATABASE_URL="postgresql://..."
export ENCRYPTION_KEY="..."
bunx tsx key-manager.ts inject
```

## Multi-Repository Setup

For organizations with multiple repositories, you can:

1. Create a centralized key management repository
2. Share the workflow across repositories
3. Use organization-level secrets

```yaml
# In other repositories
jobs:
  manage-keys:
    uses: your-org/key-management/.github/workflows/key-manager.yml@main
    secrets: inherit
```

## Best Practices

1. **Always use dry-run first**: Test with `dry_run: true` before making changes
2. **Audit regularly**: Schedule periodic key audits
3. **Document changes**: Update `key-manager.config.json` when adding new services
4. **Rotate keys**: Set reminders for key rotation
5. **Monitor access**: Review who has access to repository secrets

## Security Tips

- Use environment-specific secrets (e.g., `STAGING_DATABASE_URL`, `PROD_DATABASE_URL`)
- Limit workflow permissions to minimum required
- Enable branch protection to prevent unauthorized workflow changes
- Use GitHub's secret scanning to detect leaked secrets
- Implement approval requirements for production deployments

## Customization

### Custom External Source

Add your own key source by extending the configuration:

```json
{
  "externalSources": [
    {
      "name": "corporate-vault",
      "type": "api",
      "description": "Corporate HashiCorp Vault",
      "authSecret": "VAULT_TOKEN",
      "endpoint": "https://vault.company.com/v1/secret"
    }
  ]
}
```

### Custom Injection Target

Support additional file formats:

```json
{
  "injectionTargets": {
    "kubernetes": {
      "path": "k8s/secrets.yaml",
      "format": "kubernetes",
      "section": "data"
    },
    "terraform": {
      "path": "terraform/secrets.tfvars",
      "format": "hcl"
    }
  }
}
```

## Troubleshooting

### Keys not being stored

Check workflow permissions:
```yaml
permissions:
  contents: read
  secrets: write  # Required!
```

### External source timeout

Increase timeout in workflow:
```yaml
jobs:
  manage-keys:
    timeout-minutes: 15  # Default is 10
```

### Missing dependencies

Ensure scripts directory has dependencies:
```yaml
- name: Install dependencies
  working-directory: scripts
  run: bun install
```
