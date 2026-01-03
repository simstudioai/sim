# Key Management Quick Start

This guide gets you started with the automated key management system in minutes.

## 📋 Prerequisites

- GitHub repository with Actions enabled
- Repository admin access (for secrets management)
- Bun or Node.js installed (for local usage)

## 🚀 Quick Start

### 1. Add KEYFINDER_SECRET (Optional)

If you want to fetch keys from external sources:

1. Go to your repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `KEYFINDER_SECRET`
4. Value: Your external key finder authentication token
5. Click "Add secret"

### 2. Configure Required Keys

Edit `key-manager.config.json` to define your application's keys:

```json
{
  "requiredKeys": [
    {
      "name": "YOUR_API_KEY",
      "description": "Description of what this key is for",
      "required": true,
      "inject": [".env"]
    }
  ]
}
```

### 3. Run Key Management

#### Option A: Manual Trigger (Recommended for first run)

1. Go to Actions tab → Key Management
2. Click "Run workflow"
3. Select `check` command to see what keys exist
4. Click "Run workflow"

#### Option B: Integrate with CI/CD

Add to your workflow file:

```yaml
jobs:
  your-build:
    # ... your build steps ...

  manage-keys:
    needs: your-build
    uses: ./.github/workflows/key-manager.yml
    secrets: inherit
    with:
      command: 'scan'
```

#### Option C: Command Line

```bash
cd scripts
export GITHUB_TOKEN="your_token"
export GITHUB_REPOSITORY="owner/repo"
bunx tsx key-manager.ts check
```

## 📊 Understanding the Output

When you run the key manager, you'll see:

```
🔐 Automated Key Management System
══════════════════════════════════════════════════

🔧 Initializing Key Manager...
✅ Loaded configuration with 13 key definitions

📊 Scanning for required keys...
  • DATABASE_URL - PostgreSQL database connection string
  • ENCRYPTION_KEY - Encryption key for environment variables
  ...

🔍 Checking GitHub repository secrets...
  ✓ DATABASE_URL - found in GitHub secrets
  ✗ SOME_API_KEY - not found in GitHub secrets
✅ Found 8/13 keys in GitHub secrets

📋 Key Management Summary
══════════════════════════════════════════════════
Total keys defined: 13
  Required: 7
  Optional: 6
```

## 🔑 Common Commands

### Check existing keys
```bash
bunx tsx scripts/key-manager.ts check
```

### Scan and manage all keys
```bash
bunx tsx scripts/key-manager.ts scan
```

### Inject keys from environment
```bash
export DATABASE_URL="postgresql://..."
bunx tsx scripts/key-manager.ts inject
```

## 🛡️ Security Features

- ✅ **Automatic masking**: All key values are masked in logs
- ✅ **Memory clearing**: Sensitive data is cleared after processing
- ✅ **GitHub secrets**: Keys stored securely in repository secrets
- ✅ **No plain text**: Keys never written to plain text files in commits

## 🔄 Typical Workflow

1. **Development**: Add new API integration to your app
2. **Configuration**: Update `key-manager.config.json` with new key
3. **Storage**: Add key value to GitHub secrets manually or via key manager
4. **Deployment**: Key manager injects keys during build/deploy
5. **Cleanup**: Key manager clears sensitive data from workflow memory

## 📝 Adding a New Key

1. Edit `key-manager.config.json`:

```json
{
  "name": "STRIPE_API_KEY",
  "description": "Stripe payment processing API key",
  "pattern": "^sk_",
  "required": false,
  "inject": [".env"]
}
```

2. Add the key to GitHub secrets:
   - Go to Settings → Secrets → New repository secret
   - Name: `STRIPE_API_KEY`
   - Value: `sk_test_...`

3. Run the key manager:
```bash
bunx tsx scripts/key-manager.ts check
```

## ⚠️ Troubleshooting

### "GITHUB_TOKEN environment variable is required"

**Local usage**: Export your GitHub token:
```bash
export GITHUB_TOKEN="ghp_..."
export GITHUB_REPOSITORY="owner/repo"
```

**GitHub Actions**: Ensure workflow has permissions:
```yaml
permissions:
  contents: read
  secrets: write
```

### Keys not being injected

1. Check `key-manager.config.json` has correct `inject` array
2. Verify injection target path exists
3. Check file permissions

### External key fetch failing

1. Verify `KEYFINDER_SECRET` is set in repository secrets
2. Check external endpoint is accessible
3. Verify authentication credentials

## 🎯 Next Steps

1. ✅ Run `check` command to audit existing keys
2. ✅ Add missing keys to GitHub secrets
3. ✅ Integrate with your CI/CD pipeline
4. ✅ Set up weekly key audits
5. ✅ Document key rotation schedule

## 📚 More Information

- [Full Documentation](KEY_MANAGEMENT.md)
- [Usage Examples](KEY_MANAGEMENT_EXAMPLES.md)
- [GitHub Issues](https://github.com/al7566/sim/issues)

## 💡 Pro Tips

- Start with `dry_run: true` to test changes safely
- Use `check` command regularly to audit keys
- Document key sources in the config file
- Set calendar reminders for key rotation
- Use environment-specific secrets (PROD_*, STAGING_*)
