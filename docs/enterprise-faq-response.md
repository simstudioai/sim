# Enterprise Self-Hosting FAQ Response

This document addresses common questions from enterprise customers regarding self-hosted Sim deployments.

---

## 1. Resource Requirements and Scalability

### What drives resource consumption?

Sim's resource requirements are driven by several memory-intensive components:

| Component | Memory Driver | Description |
|-----------|--------------|-------------|
| **Isolated-VM** | High | JavaScript sandboxing for secure workflow code execution. Each concurrent workflow maintains an execution context in memory. |
| **File Processing** | Medium-High | Documents (PDF, DOCX, XLSX, etc.) are parsed in-memory before chunking for knowledge base operations. |
| **pgvector Operations** | Medium | Vector database operations for embeddings (1536 dimensions per vector for knowledge base). |
| **FFmpeg** | Variable | Media transcoding for audio/video processing happens synchronously in memory. |
| **Sharp** | Low-Medium | Image processing and manipulation. |

### Actual Production Metrics

Based on production telemetry from our cloud deployment:

**Main Application (simstudio)**
| Metric | Average | Peak | Notes |
|--------|---------|------|-------|
| CPU | ~10% | ~30% | Spikes during workflow execution |
| Memory | ~35% | ~75% | Increases with concurrent workflows |

**WebSocket Server (realtime)**
| Metric | Average | Peak | Notes |
|--------|---------|------|-------|
| CPU | ~1-2% | ~30% | Very lightweight |
| Memory | ~7% | ~13% | Scales with connected clients |

### Recommended Resource Tiers

Based on actual production data (60k+ users), we recommend the following tiers:

#### Small (Development/Testing)
- **CPU**: 2 cores
- **RAM**: 12 GB
- **Storage**: 20 GB SSD
- **Use case**: 1-5 users, development, testing, light workloads

#### Standard (Teams)
- **CPU**: 4 cores
- **RAM**: 16 GB
- **Storage**: 50 GB SSD
- **Use case**: 5-50 users, moderate workflow execution

#### Production (Enterprise)
- **CPU**: 8+ cores
- **RAM**: 32+ GB
- **Storage**: 100+ GB SSD
- **Use case**: 50+ users, high availability, heavy workflow execution
- **Note**: Consider running multiple replicas for high availability

### Memory Breakdown (Standard Deployment)

| Component | Recommended | Notes |
|-----------|-------------|-------|
| Main App | 6-8 GB | Handles workflow execution, API, UI (peaks to 12 GB under heavy load) |
| WebSocket | 1 GB | Real-time updates (typically uses 300-500 MB) |
| PostgreSQL + pgvector | 2-4 GB | Database with vector extensions |
| OS/Buffer | 2-4 GB | System overhead, file cache |
| **Total** | **~12-16 GB** | |

### Scalability Considerations

- **Horizontal scaling**: The main app and WebSocket server are stateless and can be scaled horizontally with a load balancer.
- **Database**: PostgreSQL can be scaled vertically or replaced with managed services (Supabase, Neon, RDS).
- **Workflow concurrency**: Each concurrent workflow execution consumes additional memory. Plan for peak usage.

---

## 2. Managing Releases in Enterprise Environments

### Multi-Environment Strategy

For enterprise deployments requiring dev/staging/production environments, we recommend deploying **separate Sim instances** for each environment:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│     Dev     │ -> │   Staging   │ -> │ Production  │
│  Instance   │    │  Instance   │    │  Instance   │
└─────────────┘    └─────────────┘    └─────────────┘
       │                  │                  │
       v                  v                  v
   Develop            Test/QA            Deploy
```

**Advantages**:
- Complete isolation between environments
- Independent scaling per environment
- No risk of accidental production changes
- Environment-specific configurations and credentials

### Promoting Changes Between Environments

Sim provides multiple ways to move workflows, folders, and workspaces between environments:

#### UI-Based Export/Import
1. **Export** workflows, folders, or entire workspaces from the source environment via the UI
2. **Import** into the target environment
3. Configure environment-specific variables and credentials

#### Admin APIs (Automation)
For CI/CD integration, use the admin APIs to programmatically:
- Export workflows, folders, and workspaces as JSON
- Import configurations into target environments
- Automate promotion pipelines between dev → staging → production

### Version Control Within an Instance

Within a single Sim instance, the **Deploy Modal** provides version control:

1. **Draft Mode**: Edit and test workflows without affecting the live version
2. **Explicit Deploy**: The live version is **not updated** until you explicitly click Deploy
3. **Snapshots**: Each deployment creates a snapshot of the workflow state
4. **Rollback**: Revert to any previous version at any time with one click

This allows teams to:
- Safely iterate on workflows without disrupting production
- Test changes before making them live
- Quickly recover from issues by rolling back

---

## 3. Stable Releases and Backward Compatibility

### Versioning Strategy

Sim uses the following versioning scheme:
- **Major versions** (0.x): e.g., 0.5, 0.6 - New major features
- **Minor versions** (0.x.y): e.g., 0.5.1, 0.5.2 - Incremental updates, bug fixes

### Backward Compatibility Guarantees

**Forward upgrades are safe:**
- Changes are **additive** - new features don't break existing workflows
- We ensure no breaking changes between versions
- Breaking changes are announced in advance when necessary
- Database migrations are automatic and handle schema changes

**Rollbacks are not guaranteed:**
- Rolling back to an older version may break things due to database schema changes
- Always backup your database before upgrading
- If you need to rollback, restore from a database backup taken before the upgrade

### Upgrade Best Practices

1. **Backup first**: Always backup your database before upgrading
2. **Review release notes**: Check for any announced changes
3. **Test in staging**: Upgrade your staging environment first
4. **Monitor after upgrade**: Verify workflows continue to function correctly

### Enterprise Support

For enterprise customers requiring additional stability guarantees:
- Contact us for support arrangements
- We can provide guidance on upgrade planning
- Security patches are prioritized for supported versions

---

## 4. OAuth and OIDC Providers

### Built-in OAuth Providers (Environment Variables)

Only the following providers can be configured via environment variables:

| Provider | Environment Variables |
|----------|----------------------|
| **GitHub** | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| **Google** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

There are no plans to add additional OAuth providers via environment variables.

### All Other Identity Providers (SSO)

For any other identity providers, configure SSO through the app settings:

1. Enable SSO in environment variables:
   ```
   SSO_ENABLED=true
   NEXT_PUBLIC_SSO_ENABLED=true
   ```

2. Configure your identity provider in the app's SSO settings UI

Supported protocols:
- SAML 2.0
- OpenID Connect (OIDC)

Compatible with any OIDC/SAML provider including:
- Okta
- Azure AD / Entra ID
- Auth0
- Ping Identity
- OneLogin
- Custom OIDC providers

---

## 5. Known Issues and Workarounds

### SSO Save Button Disabled

**Issue**: The 'Save' button remains disabled when configuring SSO.

**Cause**: The form has strict validation on all required fields. The button remains disabled until ALL validations pass.

**Required fields for OIDC**:
- Provider ID (letters, numbers, dashes only)
- Issuer URL (must be HTTPS, except for localhost)
- Domain (no `https://` prefix, must be valid domain format)
- Client ID
- Client Secret
- Scopes (defaults to `openid,profile,email`)

**Required fields for SAML**:
- Provider ID
- Issuer URL
- Domain
- Entry Point URL
- Certificate

**Common validation issues**:
1. **Domain field**: Do NOT include `https://` - enter only the domain (e.g., `login.okta.com` not `https://login.okta.com`)
2. **Issuer URL**: Must use HTTPS protocol (except localhost for testing)
3. **Provider ID**: Only lowercase letters, numbers, and dashes allowed (e.g., `okta-prod`)

**Debugging**:
- Open browser DevTools console to check for JavaScript errors
- Ensure `SSO_ENABLED=true` and `NEXT_PUBLIC_SSO_ENABLED=true` environment variables are set
- Try using one of the suggested provider IDs from the dropdown (e.g., `okta`, `azure-ad`)

### Access Control Group Creation

**Issue**: Button appears enabled but nothing happens when clicked.

**Cause**: For self-hosted deployments, an organization must be created via the admin API before access control groups can be used.

**Required Setup**:

1. **Enable required environment variables**:
   ```env
   ADMIN_API_KEY=your-admin-api-key
   ACCESS_CONTROL_ENABLED=true
   ORGANIZATIONS_ENABLED=true
   NEXT_PUBLIC_ACCESS_CONTROL_ENABLED=true
   NEXT_PUBLIC_ORGANIZATIONS_ENABLED=true
   ```

2. **Create an organization via admin API**:
   ```bash
   # List users to get admin user ID
   curl -H "x-admin-key: $ADMIN_API_KEY" \
     "https://your-sim-instance.com/api/v1/admin/users?limit=10"

   # Create organization
   curl -X POST https://your-sim-instance.com/api/v1/admin/organizations \
     -H "x-admin-key: $ADMIN_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"name": "Your Organization", "slug": "your-org", "ownerId": "<user-id-from-step-1>"}'

   # Add members to organization
   curl -X POST https://your-sim-instance.com/api/v1/admin/organizations/<org-id>/members \
     -H "x-admin-key: $ADMIN_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"userId": "<user-id>", "role": "member"}'
   ```

3. **Create permission groups**: After the organization is set up, go to Settings > Permission Groups in the UI.

---

## 6. File Storage Configuration

### Supported Storage Backends

Sim supports multiple storage backends for file storage:

#### Local Storage (Default)
Files are stored on the local filesystem. Suitable for development and single-node deployments.

#### AWS S3
```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET_NAME=sim-files
S3_KB_BUCKET_NAME=sim-knowledge-base
S3_EXECUTION_FILES_BUCKET_NAME=sim-execution-files
S3_CHAT_BUCKET_NAME=sim-chat-files
```

#### Azure Blob Storage

You can configure Azure Blob Storage using either a connection string or account name/key:

**Option 1: Connection String**
```env
AZURE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net
AZURE_STORAGE_CONTAINER_NAME=sim-files
AZURE_STORAGE_KB_CONTAINER_NAME=sim-knowledge-base
AZURE_STORAGE_EXECUTION_FILES_CONTAINER_NAME=sim-execution-files
AZURE_STORAGE_CHAT_CONTAINER_NAME=sim-chat-files
```

**Option 2: Account Name and Key**
```env
AZURE_ACCOUNT_NAME=your-storage-account
AZURE_ACCOUNT_KEY=your-storage-key
AZURE_STORAGE_CONTAINER_NAME=sim-files
AZURE_STORAGE_KB_CONTAINER_NAME=sim-knowledge-base
AZURE_STORAGE_EXECUTION_FILES_CONTAINER_NAME=sim-execution-files
AZURE_STORAGE_CHAT_CONTAINER_NAME=sim-chat-files
```

Both options are fully supported. The connection string is automatically parsed to extract credentials when needed for operations like presigned URL generation.

---

## 7. Knowledge Base Configuration

### Required Environment Variables

```env
# OpenAI API key for embeddings
OPENAI_API_KEY=your-openai-api-key

# Embedding model configuration (optional)
KB_OPENAI_MODEL_NAME=text-embedding-3-small
```

### Embedding Model Compatibility

**Supported models**:
- `text-embedding-3-small` (default, 1536 dimensions)
- `text-embedding-3-large` (1536 dimensions, automatically reduced from 3072)
- `text-embedding-ada-002` (1536 dimensions)

All text-embedding-3-* models automatically use 1536 dimensions to match the database schema. This allows you to use `text-embedding-3-large` for higher quality embeddings without schema modifications.

### Database Requirements

The knowledge base requires PostgreSQL with the pgvector extension:
- PostgreSQL 12+ with pgvector
- The `vector` extension must be enabled
- Tables are created automatically during migration

---

## Questions?

For additional support:
- Documentation: https://docs.sim.ai
- GitHub Issues: https://github.com/simstudioai/sim/issues
- Enterprise Support: Contact your account representative
