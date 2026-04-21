# Integration Example: Adding Key Management to CI/CD

This document shows a complete example of integrating the key management system into the existing CI workflow.

## Current CI Workflow

The repository already has a CI workflow at `.github/workflows/ci.yml` that:
1. Runs tests and builds
2. Builds Docker images
3. Deploys to ECR and GHCR

## Adding Key Management

### Option 1: End-of-Build Integration (Recommended)

Add key management after the build but before deployment:

```yaml
# In .github/workflows/ci.yml

jobs:
  # Existing jobs
  test-build:
    name: Test and Build
    uses: ./.github/workflows/test-build.yml
    secrets: inherit

  # NEW: Add key management
  manage-keys:
    name: Manage API Keys
    needs: test-build
    if: github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/staging')
    uses: ./.github/workflows/key-manager.yml
    secrets: inherit
    with:
      command: 'scan'
      dry_run: false

  # Existing deployment jobs - now depend on key management
  build-amd64:
    name: Build AMD64
    needs: [test-build, manage-keys]  # Added manage-keys dependency
    if: github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/staging')
    runs-on: blacksmith-8vcpu-ubuntu-2404
    # ... rest of the job
```

### Option 2: Separate Workflow

Create a new workflow that runs on a schedule:

```yaml
# .github/workflows/key-audit.yml
name: Weekly Key Audit

on:
  schedule:
    - cron: '0 0 * * 0'  # Every Sunday at midnight
  workflow_dispatch:     # Allow manual trigger

jobs:
  audit-keys:
    name: Audit Repository Keys
    uses: ./.github/workflows/key-manager.yml
    secrets: inherit
    with:
      command: 'check'
      dry_run: true
```

### Option 3: Pre-Deployment

Add to deployment workflows:

```yaml
# Before deploying
jobs:
  prepare-environment:
    name: Prepare Environment
    uses: ./.github/workflows/key-manager.yml
    secrets: inherit
    with:
      command: 'inject'
      dry_run: false

  deploy:
    name: Deploy
    needs: prepare-environment
    runs-on: ubuntu-latest
    steps:
      - name: Deploy application
        run: ./deploy.sh
```

## Environment-Specific Keys

For different environments (staging vs production):

```json
// key-manager.config.json
{
  "requiredKeys": [
    {
      "name": "DATABASE_URL",
      "description": "PostgreSQL database connection string",
      "required": true,
      "inject": [".env"]
    },
    {
      "name": "STAGING_DATABASE_URL",
      "description": "Staging database connection string",
      "required": false,
      "inject": [".env.staging"]
    },
    {
      "name": "PROD_DATABASE_URL",
      "description": "Production database connection string",
      "required": false,
      "inject": [".env.production"]
    }
  ]
}
```

Then in the workflow:

```yaml
jobs:
  deploy-staging:
    if: github.ref == 'refs/heads/staging'
    uses: ./.github/workflows/key-manager.yml
    secrets: inherit
    with:
      command: 'scan'
    # Will check for STAGING_DATABASE_URL

  deploy-production:
    if: github.ref == 'refs/heads/main'
    uses: ./.github/workflows/key-manager.yml
    secrets: inherit
    with:
      command: 'scan'
    # Will check for PROD_DATABASE_URL
```

## Docker Build Integration

Inject keys before building Docker images:

```yaml
jobs:
  prepare-keys:
    uses: ./.github/workflows/key-manager.yml
    secrets: inherit
    with:
      command: 'inject'

  build-docker:
    needs: prepare-keys
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # Keys are now available in .env
      - name: Build Docker image
        run: |
          docker build \
            --build-arg DATABASE_URL=${{ secrets.DATABASE_URL }} \
            --build-arg ENCRYPTION_KEY=${{ secrets.ENCRYPTION_KEY }} \
            -t myapp:latest .
```

## Complete Example

Here's a complete workflow showing all pieces together:

```yaml
name: Complete CI/CD with Key Management

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main]

jobs:
  # 1. Test and build
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run tests
        run: npm test

  # 2. Manage keys (only on push to main/staging)
  manage-keys:
    needs: test
    if: github.event_name == 'push'
    uses: ./.github/workflows/key-manager.yml
    secrets: inherit
    with:
      command: 'scan'
      dry_run: false

  # 3. Build (depends on keys being ready)
  build:
    needs: [test, manage-keys]
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build application
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          ENCRYPTION_KEY: ${{ secrets.ENCRYPTION_KEY }}
        run: npm run build

  # 4. Deploy (only on main)
  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to production
        run: ./deploy.sh
```

## Local Development Setup

For developers working locally:

```bash
# 1. Install dependencies
cd scripts
npm install

# 2. Set up authentication
export GITHUB_TOKEN="your_github_personal_access_token"
export GITHUB_REPOSITORY="al7566/sim"

# 3. Check current keys
bunx tsx key-manager.ts check

# 4. Inject keys from environment (for local .env)
export DATABASE_URL="postgresql://localhost:5432/simstudio"
export ENCRYPTION_KEY="$(openssl rand -hex 32)"
export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
bunx tsx key-manager.ts inject
```

## Monitoring and Alerts

Set up notifications for key management:

```yaml
jobs:
  manage-keys:
    uses: ./.github/workflows/key-manager.yml
    secrets: inherit
    with:
      command: 'scan'

  notify:
    needs: manage-keys
    if: failure()
    runs-on: ubuntu-latest
    steps:
      - name: Send notification
        run: |
          echo "Key management failed!" | \
          curl -X POST ${{ secrets.SLACK_WEBHOOK }} \
            -H 'Content-Type: application/json' \
            -d '{"text":"Key management workflow failed"}'
```

## Security Considerations

1. **Branch Protection**: Enable branch protection for main/staging
2. **Required Reviews**: Require reviews for workflow changes
3. **CODEOWNERS**: Add `.github/workflows/` to CODEOWNERS
4. **Audit Logs**: Review GitHub audit logs regularly
5. **Rotate Keys**: Set up calendar reminders for key rotation

## Rollback Plan

If key management causes issues:

```yaml
# Temporarily disable by setting dry_run: true
jobs:
  manage-keys:
    uses: ./.github/workflows/key-manager.yml
    secrets: inherit
    with:
      command: 'check'
      dry_run: true  # Just check, don't modify
```

Or comment out the key management job entirely while you investigate.

## Testing the Integration

1. **Test in a fork first**:
   ```bash
   # Fork the repository
   # Add required secrets to fork
   # Test workflow runs
   ```

2. **Use dry-run mode**:
   ```yaml
   with:
     dry_run: true  # Test without making changes
   ```

3. **Start with `check` command**:
   ```yaml
   with:
     command: 'check'  # Just audit, don't modify
   ```

4. **Monitor workflow runs**:
   - Check Actions tab
   - Review workflow logs
   - Verify no sensitive data exposed

## Troubleshooting

### Keys not being found
- Verify secrets are added to repository settings
- Check secret names match configuration
- Ensure proper permissions on workflow

### Workflow fails
- Check workflow logs for errors
- Verify GitHub token has required permissions
- Test locally with same commands

### Keys not injected
- Check file paths in configuration
- Verify injection targets exist
- Review workflow artifacts

## Next Steps

After successful integration:

1. ✅ Set up weekly key audits
2. ✅ Document key rotation schedule
3. ✅ Add keys to .env.example with dummy values
4. ✅ Train team on key management workflow
5. ✅ Set up monitoring and alerts

## Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [GitHub Secrets Management](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Key Management Documentation](KEY_MANAGEMENT.md)
- [Quick Start Guide](KEY_MANAGEMENT_QUICKSTART.md)
