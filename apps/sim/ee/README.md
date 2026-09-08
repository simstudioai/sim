# Sim Enterprise Edition

This directory contains enterprise features that require a Sim Enterprise subscription
for production use.

## Features

- **SSO (Single Sign-On)**: OIDC and SAML authentication integration
- **Access Control**: Permission groups for fine-grained user access management
- **Audit Logs**: Organization-wide audit trail with search and export
- **Data Drains**: Streaming of logs and audit events to external destinations
- **Data Retention**: Organization-level retention windows for execution data
- **Session Policies**: Session lifetime and idle-timeout controls
- **Custom Blocks**: Organization-owned reusable blocks for the workflow builder
- **Usage Monitoring**: Organization usage breakdown, consumers, and event export
- **Workspace Forking**: Fork, sync, and promote workspaces across environments
- **Whitelabeling**: Custom branding and theming for enterprise deployments

Each feature keeps its server code under `ee/<feature>/lib`, its React Query hooks under
`ee/<feature>/hooks`, and its UI under `ee/<feature>/components`. Contracts stay in
`lib/api/contracts` and routes under `app/api`, so the enterprise directory is imported by the
rest of the app rather than the other way round.

## Licensing

See [LICENSE](./LICENSE) for terms. Development and testing use is permitted.
Production deployment requires an active Enterprise subscription.

## Architecture

Enterprise features are imported directly throughout the codebase. The `ee/` directory
is required at build time. Feature visibility is controlled at runtime via environment
variables (e.g., `NEXT_PUBLIC_ACCESS_CONTROL_ENABLED`, `NEXT_PUBLIC_SSO_ENABLED`).
