# GitHub Actions Workflows

This directory contains GitHub Actions workflows for automating the deployment of Paperless Automation to the Oppulence Kubernetes cluster.

## 📁 Directory Structure

```
.github/
├── workflows/
│   ├── deploy-helm-template.yml      # Reusable Helm deployment workflow
│   └── deploy-production.yml         # Production deployment pipeline
├── DEPLOYMENT.md                     # Complete deployment guide
├── SECRETS-SETUP.md                  # GitHub secrets setup guide
└── README.md                         # This file
```

## 🚀 Quick Start

### 1. Set Up GitHub Secrets

Follow the [Secrets Setup Guide](SECRETS-SETUP.md) to configure all required secrets.

**Required secrets (6):**
- `KUBE_CONFIG_DATA` - Kubernetes cluster credentials
- `BETTER_AUTH_SECRET` - JWT signing key
- `ENCRYPTION_KEY` - Data encryption key
- `INTERNAL_API_SECRET` - Service authentication
- `CRON_SECRET` - Cron job authentication
- `POSTGRESQL_PASSWORD` - Database password

**Optional secrets (9):**
- OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- AI: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- Storage: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`

### 2. Deploy to Production

**Automatic deployment:**
- Push to `main` branch triggers automatic deployment

**Manual deployment:**
1. Go to **Actions** tab
2. Select **Deploy to Production**
3. Click **Run workflow**
4. Select `main` branch
5. (Optional) Check "Force deployment"
6. Click **Run workflow**

### 3. Monitor Deployment

Check deployment status:
- **GitHub Actions**: View workflow progress in Actions tab
- **Health Check**: https://paperless-automation.oppulence.app/health
- **Kubernetes**: `kubectl get pods -n oppulence`

## 📖 Documentation

| Document | Purpose |
|----------|---------|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Complete deployment guide with architecture, process, and troubleshooting |
| [SECRETS-SETUP.md](SECRETS-SETUP.md) | Quick reference for setting up GitHub secrets |

## 🔄 Workflows

### deploy-production.yml

Main production deployment pipeline that runs on push to `main` branch.

**Triggers:**
- Push to `main` branch (with changes to relevant paths)
- Manual workflow dispatch

**Jobs:**
1. **check-changes**: Determine if deployment should proceed
2. **build-and-push**: Build multi-platform Docker image and push to GHCR
3. **deploy-production**: Deploy Helm chart to Kubernetes cluster
4. **health-check**: Verify deployment health
5. **notify**: Send deployment status notification

**Environment:**
- Namespace: `oppulence`
- Domain: `paperless-automation.oppulence.app`
- WebSocket Domain: `paperless-automation-ws.oppulence.app`

### deploy-helm-template.yml

Reusable workflow template for Helm deployments.

**Purpose:**
- Can be called by other workflows for different environments (staging, production)
- Handles Helm upgrade/install with secret injection
- Performs health checks

**Inputs:**
- `service_name`: Deployment name
- `chart_repository`: Helm chart path
- `namespace`: Kubernetes namespace
- `values_file`: Values file overlay
- `image_repository`: Docker image repository
- `image_tag`: Image tag

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     GitHub Actions                          │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │ Check Changes│───▶│ Build & Push │───▶│ Deploy Helm  │ │
│  └──────────────┘    └──────────────┘    └──────────────┘ │
│                              │                     │        │
│                              ▼                     ▼        │
│                        ┌─────────┐         ┌─────────────┐ │
│                        │  GHCR   │         │ Kubernetes  │ │
│                        └─────────┘         └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 🔒 Security Features

1. **Environment Variable Escaping**: All GitHub context values used in shell commands are properly escaped via environment variables
2. **Secret Management**: Secrets injected at deployment time, never logged
3. **TLS/HTTPS**: All ingress routes use HTTPS with cert-manager
4. **Network Policies**: Pod-to-pod communication restricted (when enabled)
5. **Non-root Containers**: All containers run as non-root user (UID 1001)

## 📊 Deployment Targets

### Production

- **Namespace**: `oppulence`
- **Domain**: `paperless-automation.oppulence.app`
- **Replicas**: 2+ (with autoscaling 2-5)
- **Database**: PostgreSQL with 20Gi storage
- **High Availability**: Pod disruption budgets, autoscaling enabled

## 🛠️ Development

### Testing Workflows Locally

Use [act](https://github.com/nektos/act) to test workflows locally:

```bash
# Install act
brew install act

# Test the production workflow
act -W .github/workflows/deploy-production.yml

# Test with secrets
act -W .github/workflows/deploy-production.yml --secret-file .secrets
```

### Modifying Workflows

When modifying workflows:

1. **Security**: Never use GitHub context values directly in `run:` commands
2. **Testing**: Test changes in a feature branch first
3. **Documentation**: Update this README if adding new workflows
4. **Secrets**: Add new secrets to SECRETS-SETUP.md checklist

## 📝 Deployment Checklist

Before your first deployment:

- [ ] All required secrets configured in GitHub
- [ ] Kubeconfig tested and base64-encoded correctly
- [ ] Domain DNS records point to cluster ingress
- [ ] TLS certificates configured (cert-manager or manual)
- [ ] Database backup strategy in place
- [ ] Monitoring/alerting configured (optional)
- [ ] OAuth providers configured (if using social login)
- [ ] Email provider configured (Resend API key)

## 🐛 Troubleshooting

### Deployment Fails

1. **Check GitHub Actions logs**: Click on failed workflow run
2. **Verify secrets**: Ensure all required secrets are set
3. **Check kubeconfig**: Verify `KUBE_CONFIG_DATA` is valid base64
4. **Review pod logs**: `kubectl logs -n oppulence <pod-name>`

### Health Check Fails

```bash
# Check pod status
kubectl get pods -n oppulence -l app.kubernetes.io/name=sim

# View logs
kubectl logs -n oppulence <pod-name>

# Check service endpoints
kubectl get endpoints -n oppulence
```

### Rollback Deployment

```bash
# View Helm history
helm history paperless-automation -n oppulence

# Rollback to previous version
helm rollback paperless-automation -n oppulence
```

See [DEPLOYMENT.md](DEPLOYMENT.md#troubleshooting) for detailed troubleshooting guide.

## 📚 Additional Resources

- [Helm Documentation](https://helm.sh/docs/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Oppulence Infrastructure Wiki](../ARCHITECTURE.md) *(if available)*

## 🤝 Support

For deployment issues:

1. Check the [Deployment Guide](DEPLOYMENT.md)
2. Review GitHub Actions logs
3. Check Kubernetes pod logs
4. Contact DevOps team for cluster access issues
5. Open an issue for application-specific problems

---

**Last Updated**: 2024
**Maintained By**: Oppulence Engineering
