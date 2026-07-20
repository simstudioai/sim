import type { WorkflowEvalStreamEvent } from '@/lib/api/contracts/workflow-evals'
import { createPubSubChannel, type PubSubChannel } from '@/lib/events/pubsub'

interface WorkflowEvalPubSubAdapter {
  publish(event: WorkflowEvalStreamEvent): void
  subscribe(handler: (event: WorkflowEvalStreamEvent) => void): () => void
  dispose(): void
}

type WorkflowEvalPubSubGlobal = typeof globalThis & {
  _workflowEvalEventChannel?: PubSubChannel<WorkflowEvalStreamEvent> | null
}

const globalState = globalThis as WorkflowEvalPubSubGlobal

if (!('_workflowEvalEventChannel' in globalState)) {
  globalState._workflowEvalEventChannel =
    typeof window === 'undefined'
      ? createPubSubChannel<WorkflowEvalStreamEvent>({
          channel: 'workflow:evals:updated:v1',
          label: 'workflow-evals',
          bufferPublishesWhileDisconnected: false,
        })
      : null
}

const channel = globalState._workflowEvalEventChannel

export const workflowEvalPubSub: WorkflowEvalPubSubAdapter | null =
  typeof window !== 'undefined' || !channel
    ? null
    : {
        publish: (event) => channel.publish(event),
        subscribe: (handler) => channel.subscribe(handler),
        dispose: () => channel.dispose(),
      }
