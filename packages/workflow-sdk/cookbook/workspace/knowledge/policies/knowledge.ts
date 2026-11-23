// @sim-sdk 1
import { defineKnowledgeBase } from '@sim/workflow-sdk/workspace'

// knowledge/<key>/knowledge.ts, with one file per document in knowledge/<key>/docs/ (flat, each
// at most 10 MB). A workflow names it as knowledgeBase('policies').
export default defineKnowledgeBase({
  name: 'Policies',
  description: 'Refund and shipping policies',
  chunking: { maxSize: 1024, minSize: 100, overlap: 200 },
})
