import type { TraceRootConfigFile } from 'traceroot-sdk-ts'

const config: TraceRootConfigFile = {
  // Basic service configuration
  service_name: 'sim',
  github_owner: 'simstudioai',
  github_repo_name: 'sim',
  github_commit_hash: 'staging',

  // Your environment configuration such as development, staging, production
  environment: process.env.NODE_ENV || 'development',

  // Token configuration
  // This is the token you can generate from the TraceRoot.AI website
  token: 'traceroot-*',

  // Whether to enable console export of spans and logs
  enable_span_console_export: false,
  enable_log_console_export: true,

  // Whether to enable cloud export of spans and logs
  enable_span_cloud_export: false,
  enable_log_cloud_export: false,

  // Log level
  log_level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',

  // Local mode that whether to store all TraceRoot data locally
  // and allow traceroot platform serving locally
  // This requires Jaeger to be installed and running
  local_mode: false,

  // Whether to auto-initialize the traceroot SDK
  autoInit: true,
}
export default config
