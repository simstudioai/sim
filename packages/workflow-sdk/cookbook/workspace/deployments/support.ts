// @sim-sdk 1
import { defineDeployment } from '@sim/workflow-sdk/workspace'

// deployments/<workflow key>.ts deploys workflows/<workflow key>/ after the apply writes it.
// 'draft' publishes the draft whenever it differs from the live version; 'pinned' never does.
export default defineDeployment({
  live: 'draft',
  api: { public: false },
  chat: {
    identifier: 'support-example',
    title: 'Support',
    // A password is a secret by name, never its value: auth: { password: env.CHAT_PASSWORD }.
    auth: { emails: ['@example.com'] },
    outputs: [{ block: 'Answer', path: 'content' }],
  },
})
