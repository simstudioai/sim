# Deployment Guide: Paperless Automation

This guide explains how to deploy the Paperless Automation application to your Kubernetes cluster using GitHub Actions.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [GitHub Secrets Configuration](#github-secrets-configuration)
- [Kubeconfig Setup](#kubeconfig-setup)
- [Deployment Process](#deployment-process)
- [Troubleshooting](#troubleshooting)

---

## Overview

The deployment pipeline uses:
- **GitHub Actions** for CI/CD automation
- **Helm** for Kubernetes package management
- **GitHub Container Registry (GHCR)** for Docker images
- **Kubernetes** cluster (Oppulence infrastructure)

### Architecture

```
┌─────────────────┐
│  GitHub Actions │
│   (CI/CD)       │
└────────┬────────┘
         │
         ├──► Build & Push Docker Images (GHCR)
         │
         ├──► Deploy Helm Chart to Kubernetes
         │
         └──► Run Health Checks
```

---

## Prerequisites

1. **Kubernetes Cluster**: Access to the Oppulence Kubernetes cluster
2. **GitHub Repository**: Admin access to configure secrets
3. **Kubectl Access**: Kubeconfig file with cluster credentials
4. **Domain Names**:
   - `paperless-automation.oppulence.app` (main application)
   - `paperless-automation-ws.oppulence.app` (WebSocket/realtime)

---

## GitHub Secrets Configuration

Navigate to your repository: **Settings → Secrets and variables → Actions → New repository secret**

### Required Secrets

#### 1. Kubernetes Configuration

| Secret Name | Description | How to Get |
|------------|-------------|------------|
| `KUBE_CONFIG_DATA` | Base64-encoded kubeconfig file | See [Kubeconfig Setup](#kubeconfig-setup) below |

#### 2. Application Secrets

| Secret Name | Description | How to Generate |
|------------|-------------|-----------------|
| `BETTER_AUTH_SECRET` | JWT signing key for authentication | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | Data encryption key | `openssl rand -hex 32` |
| `INTERNAL_API_SECRET` | Service-to-service authentication | `openssl rand -hex 32` |
| `CRON_SECRET` | Scheduled job authentication | `openssl rand -hex 32` |

#### 3. Database

| Secret Name | Description |
|------------|-------------|
| `POSTGRESQL_PASSWORD` | PostgreSQL database password (strong password recommended) |

#### 4. OAuth Providers (Optional)

| Secret Name | Description | Provider |
|------------|-------------|----------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | [Google Cloud Console](https://console.cloud.google.com/) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Google Cloud Console |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID | [GitHub Settings → Developer settings](https://github.com/settings/developers) |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret | GitHub Developer settings |

**OAuth Redirect URLs:**
- Google: `https://paperless-automation.oppulence.app/api/auth/callback/google`
- GitHub: `https://paperless-automation.oppulence.app/api/auth/callback/github`

#### 5. AI/LLM API Keys (Optional)

| Secret Name | Description |
|------------|-------------|
| `OPENAI_API_KEY` | OpenAI API key for GPT models |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude models |

#### 6. AWS S3 Storage (Optional)

| Secret Name | Description |
|------------|-------------|
| `AWS_ACCESS_KEY_ID` | AWS IAM access key ID |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM secret access key |
| `S3_BUCKET_NAME` | S3 bucket name for file storage |

---

## Kubeconfig Setup

### Step 1: Get Your Kubeconfig

If you already have kubectl configured for your cluster:

```bash
cat ~/.kube/config
```

Or get it from your cluster administrator.

### Step 2: Encode Kubeconfig

Encode the entire kubeconfig file to base64:

```bash
# Linux/macOS
cat ~/.kube/config | base64 | tr -d '\n'

# Or using a file
base64 -i ~/.kube/config | tr -d '\n'
```

### Step 3: Add to GitHub Secrets

1. Copy the entire base64 output
2. Go to GitHub repository → **Settings → Secrets and variables → Actions**
3. Click **New repository secret**
4. Name: `KUBE_CONFIG_DATA`
5. Value: Paste the base64-encoded kubeconfig
6. Click **Add secret**

### Kubeconfig Structure

Your kubeconfig should look similar to this (from the Oppulence Canvas API example):

```yaml
apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: LS0tLS...
    server: https://5.161.36.114:6443
  name: oppulence-infrastructure
contexts:
- context:
    cluster: oppulence-infrastructure
    user: oppulence-infrastructure
  name: oppulence-infrastructure
current-context: oppulence-infrastructure
kind: Config
users:
- name: oppulence-infrastructure
  user:
    client-certificate-data: LS0tLS...
    client-key-data: LS0tLS...
```

---

## Deployment Process

### Automatic Deployments

The deployment happens automatically on:

1. **Push to `main` branch** with changes to:
   - `packages/**`
   - `apps/**`
   - `helm/sim/**`
   - `.github/workflows/deploy-production.yml`

2. **Manual trigger** via GitHub Actions UI (workflow_dispatch)

### Deployment Steps

The workflow performs these steps:

```
1. Check for changes (path filtering)
   ↓
2. Build Docker image (multi-platform: amd64, arm64)
   ↓
3. Push image to GHCR (ghcr.io/oppulence-engineering/paperless-automation)
   ↓
4. Deploy Helm chart to Kubernetes
   ↓
5. Wait for deployment stabilization (60 seconds)
   ↓
6. Run health checks (https://paperless-automation.oppulence.app/health)
   ↓
7. Generate deployment summary
```

### Manual Deployment

To manually trigger a deployment:

1. Go to **Actions** tab in GitHub
2. Select **Deploy to Production** workflow
3. Click **Run workflow**
4. Select branch: `main`
5. (Optional) Check "Force deployment"
6. Click **Run workflow**

---

## Monitoring Deployment

### View Deployment Progress

1. **GitHub Actions**: Go to the Actions tab to see workflow progress
2. **Kubernetes Dashboard**: Monitor pods and services
3. **Logs**: Check application logs

### Kubernetes Commands

```bash
# Check deployment status
kubectl get deployments -n oppulence

# Check pods
kubectl get pods -n oppulence

# View logs for main app
kubectl logs -n oppulence -l app.kubernetes.io/name=sim,app.kubernetes.io/component=app

# View logs for realtime service
kubectl logs -n oppulence -l app.kubernetes.io/name=sim,app.kubernetes.io/component=realtime

# Check services
kubectl get services -n oppulence

# Check ingress
kubectl get ingress -n oppulence
```

### Health Check Endpoints

- **Main App**: `https://paperless-automation.oppulence.app/health`
- **Realtime Service**: `https://paperless-automation-ws.oppulence.app/health`

---

## Deployed Services

After successful deployment, the following services will be running:

| Service | Replicas | Description |
|---------|----------|-------------|
| **sim-app** | 2+ (autoscaling) | Main Next.js application |
| **sim-realtime** | 1 | WebSocket realtime service |
| **sim-postgresql** | 1 (StatefulSet) | PostgreSQL database with pgvector |

### Ingress Routes

| Domain | Service | Protocol |
|--------|---------|----------|
| `paperless-automation.oppulence.app` | sim-app | HTTPS |
| `paperless-automation-ws.oppulence.app` | sim-realtime | WSS (WebSocket) |

---

## Troubleshooting

### Deployment Failed

**Check GitHub Actions logs:**

1. Go to Actions tab
2. Click on failed workflow run
3. Expand failed steps to see error messages

**Common issues:**

- **Missing secrets**: Ensure all required secrets are configured
- **Image pull errors**: Verify GHCR credentials and image exists
- **Kubeconfig invalid**: Re-encode and update `KUBE_CONFIG_DATA` secret
- **Resource limits**: Check if cluster has sufficient resources

### Health Checks Failing

```bash
# Check pod status
kubectl get pods -n oppulence -l app.kubernetes.io/name=sim

# Check pod logs
kubectl logs -n oppulence <pod-name>

# Describe pod for events
kubectl describe pod -n oppulence <pod-name>

# Check service endpoints
kubectl get endpoints -n oppulence
```

### Database Connection Issues

```bash
# Check PostgreSQL pod
kubectl get pods -n oppulence -l app.kubernetes.io/name=postgresql

# Check PostgreSQL logs
kubectl logs -n oppulence <postgresql-pod-name>

# Test database connection from app pod
kubectl exec -it -n oppulence <app-pod-name> -- bash
# Inside pod:
psql $DATABASE_URL
```

### Rolling Back

To rollback to a previous deployment:

```bash
# List Helm releases
helm list -n oppulence

# Check release history
helm history paperless-automation -n oppulence

# Rollback to previous revision
helm rollback paperless-automation -n oppulence

# Or rollback to specific revision
helm rollback paperless-automation <revision-number> -n oppulence
```

### Update Secrets

If you need to update secrets after deployment:

1. Update the GitHub secret in repository settings
2. Trigger a new deployment (push to main or manual trigger)
3. Or manually update using kubectl:

```bash
# Delete old secret
kubectl delete secret sim-app-secret -n oppulence

# Helm will recreate it on next deployment
```

---

## Security Best Practices

1. **Never commit secrets** to the repository
2. **Rotate secrets regularly** (especially database passwords and API keys)
3. **Use strong passwords**: Minimum 32 characters for encryption keys
4. **Limit access**: Only grant cluster access to necessary personnel
5. **Enable OAuth** for production (don't rely on email/password alone)
6. **Monitor logs** for suspicious activity
7. **Keep dependencies updated** to patch security vulnerabilities

---

## Next Steps

After successful deployment:

1. **Configure DNS**: Ensure domains point to cluster ingress
2. **Set up monitoring**: Configure Prometheus/Grafana (optional)
3. **Configure backups**: Set up automated PostgreSQL backups
4. **Test OAuth flows**: Verify Google/GitHub login works
5. **Configure email**: Test email sending via Resend
6. **Set up alerts**: Configure alerting for failed deployments

---

## Support

For issues or questions:

- Check GitHub Actions logs
- Review Kubernetes pod logs
- Contact DevOps team for cluster access issues
- Open an issue in the repository for application bugs
