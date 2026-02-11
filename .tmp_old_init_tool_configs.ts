/**
 * Initialize all tool UI configurations.
 *
 * This module imports all client tools to trigger their UI config registration.
 * Import this module early in the app to ensure all tool configs are available.
 */

// Other tools (subagents)
import './other/auth'
import './other/custom-tool'
import './other/debug'
import './other/deploy'
import './other/edit'
import './other/evaluate'
import './other/info'
import './other/knowledge'
import './other/make-api-request'
import './other/plan'
import './other/research'
import './other/sleep'
import './other/superagent'
import './other/test'
import './other/tour'
import './other/workflow'

// Workflow tools
import './workflow/deploy-api'
import './workflow/deploy-chat'
import './workflow/deploy-mcp'
import './workflow/edit-workflow'
import './workflow/redeploy'
import './workflow/run-workflow'
import './workflow/set-global-workflow-variables'

// User tools
import './user/set-environment-variables'
