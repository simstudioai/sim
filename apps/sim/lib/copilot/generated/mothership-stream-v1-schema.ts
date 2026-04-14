// AUTO-GENERATED FILE. DO NOT EDIT.
// Generated from copilot/contracts/mothership-stream-v1.schema.json
//

export type JsonSchema = unknown

export const MOTHERSHIP_STREAM_V1_SCHEMA: JsonSchema = {
  $defs: {
    MothershipStreamV1AdditionalPropertiesMap: {
      additionalProperties: true,
      type: 'object',
    },
    MothershipStreamV1AsyncToolRecordStatus: {
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled', 'delivered'],
      type: 'string',
    },
    MothershipStreamV1CheckpointPauseEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1CheckpointPausePayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['run'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1CheckpointPauseFrame: {
      additionalProperties: false,
      properties: {
        parentToolCallId: {
          type: 'string',
        },
        parentToolName: {
          type: 'string',
        },
        pendingToolIds: {
          items: {
            type: 'string',
          },
          type: 'array',
        },
      },
      required: ['parentToolCallId', 'parentToolName', 'pendingToolIds'],
      type: 'object',
    },
    MothershipStreamV1CheckpointPausePayload: {
      additionalProperties: false,
      properties: {
        checkpointId: {
          type: 'string',
        },
        executionId: {
          type: 'string',
        },
        frames: {
          items: {
            $ref: '#/$defs/MothershipStreamV1CheckpointPauseFrame',
          },
          type: 'array',
        },
        kind: {
          enum: ['checkpoint_pause'],
          type: 'string',
        },
        pendingToolCallIds: {
          items: {
            type: 'string',
          },
          type: 'array',
        },
        runId: {
          type: 'string',
        },
      },
      required: ['kind', 'checkpointId', 'runId', 'executionId', 'pendingToolCallIds'],
      type: 'object',
    },
    MothershipStreamV1CompactionDoneData: {
      additionalProperties: false,
      properties: {
        summary_chars: {
          type: 'integer',
        },
      },
      required: ['summary_chars'],
      type: 'object',
    },
    MothershipStreamV1CompactionDoneEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1CompactionDonePayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['run'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1CompactionDonePayload: {
      additionalProperties: false,
      properties: {
        data: {
          $ref: '#/$defs/MothershipStreamV1CompactionDoneData',
        },
        kind: {
          enum: ['compaction_done'],
          type: 'string',
        },
      },
      required: ['kind'],
      type: 'object',
    },
    MothershipStreamV1CompactionStartEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1CompactionStartPayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['run'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1CompactionStartPayload: {
      additionalProperties: false,
      properties: {
        kind: {
          enum: ['compaction_start'],
          type: 'string',
        },
      },
      required: ['kind'],
      type: 'object',
    },
    MothershipStreamV1CompleteEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1CompletePayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['complete'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1CompletePayload: {
      additionalProperties: false,
      properties: {
        cost: {
          $ref: '#/$defs/MothershipStreamV1CostData',
        },
        reason: {
          type: 'string',
        },
        response: true,
        status: {
          $ref: '#/$defs/MothershipStreamV1CompletionStatus',
        },
        usage: {
          $ref: '#/$defs/MothershipStreamV1UsageData',
        },
      },
      required: ['status'],
      type: 'object',
    },
    MothershipStreamV1CompletionStatus: {
      enum: ['complete', 'error', 'cancelled'],
      type: 'string',
    },
    MothershipStreamV1CostData: {
      additionalProperties: false,
      properties: {
        input: {
          type: 'number',
        },
        output: {
          type: 'number',
        },
        total: {
          type: 'number',
        },
      },
      type: 'object',
    },
    MothershipStreamV1ErrorEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1ErrorPayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['error'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1ErrorPayload: {
      additionalProperties: false,
      properties: {
        code: {
          type: 'string',
        },
        data: true,
        displayMessage: {
          type: 'string',
        },
        error: {
          type: 'string',
        },
        message: {
          type: 'string',
        },
        provider: {
          type: 'string',
        },
      },
      required: ['message'],
      type: 'object',
    },
    MothershipStreamV1EventEnvelopeCommon: {
      additionalProperties: false,
      properties: {
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream'],
      type: 'object',
    },
    MothershipStreamV1EventType: {
      enum: ['session', 'text', 'tool', 'span', 'resource', 'run', 'error', 'complete'],
      type: 'string',
    },
    MothershipStreamV1ResourceDescriptor: {
      additionalProperties: false,
      properties: {
        id: {
          type: 'string',
        },
        title: {
          type: 'string',
        },
        type: {
          type: 'string',
        },
      },
      required: ['type', 'id'],
      type: 'object',
    },
    MothershipStreamV1ResourceOp: {
      enum: ['upsert', 'remove'],
      type: 'string',
    },
    MothershipStreamV1ResourceRemoveEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1ResourceRemovePayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['resource'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1ResourceRemovePayload: {
      additionalProperties: false,
      properties: {
        op: {
          enum: ['remove'],
          type: 'string',
        },
        resource: {
          $ref: '#/$defs/MothershipStreamV1ResourceDescriptor',
        },
      },
      required: ['op', 'resource'],
      type: 'object',
    },
    MothershipStreamV1ResourceUpsertEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1ResourceUpsertPayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['resource'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1ResourceUpsertPayload: {
      additionalProperties: false,
      properties: {
        op: {
          enum: ['upsert'],
          type: 'string',
        },
        resource: {
          $ref: '#/$defs/MothershipStreamV1ResourceDescriptor',
        },
      },
      required: ['op', 'resource'],
      type: 'object',
    },
    MothershipStreamV1ResumeRequest: {
      additionalProperties: false,
      properties: {
        checkpointId: {
          type: 'string',
        },
        results: {
          items: {
            $ref: '#/$defs/MothershipStreamV1ResumeToolResult',
          },
          type: 'array',
        },
        streamId: {
          type: 'string',
        },
      },
      required: ['streamId', 'checkpointId', 'results'],
      type: 'object',
    },
    MothershipStreamV1ResumeToolResult: {
      additionalProperties: false,
      properties: {
        error: {
          type: 'string',
        },
        output: true,
        success: {
          type: 'boolean',
        },
        toolCallId: {
          type: 'string',
        },
      },
      required: ['toolCallId', 'success'],
      type: 'object',
    },
    MothershipStreamV1RunKind: {
      enum: ['checkpoint_pause', 'resumed', 'compaction_start', 'compaction_done'],
      type: 'string',
    },
    MothershipStreamV1RunResumedEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1RunResumedPayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['run'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1RunResumedPayload: {
      additionalProperties: false,
      properties: {
        kind: {
          enum: ['resumed'],
          type: 'string',
        },
      },
      required: ['kind'],
      type: 'object',
    },
    MothershipStreamV1SessionChatEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1SessionChatPayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['session'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1SessionChatPayload: {
      additionalProperties: false,
      properties: {
        chatId: {
          type: 'string',
        },
        kind: {
          enum: ['chat'],
          type: 'string',
        },
      },
      required: ['kind', 'chatId'],
      type: 'object',
    },
    MothershipStreamV1SessionKind: {
      enum: ['trace', 'chat', 'title', 'start'],
      type: 'string',
    },
    MothershipStreamV1SessionStartData: {
      additionalProperties: false,
      properties: {
        responseId: {
          type: 'string',
        },
      },
      type: 'object',
    },
    MothershipStreamV1SessionStartEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1SessionStartPayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['session'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1SessionStartPayload: {
      additionalProperties: false,
      properties: {
        data: {
          $ref: '#/$defs/MothershipStreamV1SessionStartData',
        },
        kind: {
          enum: ['start'],
          type: 'string',
        },
      },
      required: ['kind'],
      type: 'object',
    },
    MothershipStreamV1SessionTitleEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1SessionTitlePayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['session'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1SessionTitlePayload: {
      additionalProperties: false,
      properties: {
        kind: {
          enum: ['title'],
          type: 'string',
        },
        title: {
          type: 'string',
        },
      },
      required: ['kind', 'title'],
      type: 'object',
    },
    MothershipStreamV1SessionTraceEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1SessionTracePayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['session'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1SessionTracePayload: {
      additionalProperties: false,
      properties: {
        kind: {
          enum: ['trace'],
          type: 'string',
        },
        requestId: {
          type: 'string',
        },
        spanId: {
          type: 'string',
        },
      },
      required: ['kind', 'requestId'],
      type: 'object',
    },
    MothershipStreamV1SpanKind: {
      enum: ['subagent'],
      type: 'string',
    },
    MothershipStreamV1SpanLifecycleEvent: {
      enum: ['start', 'end'],
      type: 'string',
    },
    MothershipStreamV1SpanPayloadKind: {
      enum: ['subagent', 'structured_result', 'subagent_result'],
      type: 'string',
    },
    MothershipStreamV1StreamCursor: {
      additionalProperties: false,
      properties: {
        cursor: {
          type: 'string',
        },
        seq: {
          type: 'integer',
        },
        streamId: {
          type: 'string',
        },
      },
      required: ['streamId', 'cursor', 'seq'],
      type: 'object',
    },
    MothershipStreamV1StreamRef: {
      additionalProperties: false,
      properties: {
        chatId: {
          type: 'string',
        },
        cursor: {
          type: 'string',
        },
        streamId: {
          type: 'string',
        },
      },
      required: ['streamId'],
      type: 'object',
    },
    MothershipStreamV1StreamScope: {
      additionalProperties: false,
      properties: {
        agentId: {
          type: 'string',
        },
        lane: {
          enum: ['subagent'],
          type: 'string',
        },
        parentToolCallId: {
          type: 'string',
        },
      },
      required: ['lane'],
      type: 'object',
    },
    MothershipStreamV1StructuredResultSpanEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1StructuredResultSpanPayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['span'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1StructuredResultSpanPayload: {
      additionalProperties: false,
      properties: {
        agent: {
          type: 'string',
        },
        data: true,
        kind: {
          enum: ['structured_result'],
          type: 'string',
        },
      },
      required: ['kind'],
      type: 'object',
    },
    MothershipStreamV1SubagentResultSpanEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1SubagentResultSpanPayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['span'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1SubagentResultSpanPayload: {
      additionalProperties: false,
      properties: {
        agent: {
          type: 'string',
        },
        data: true,
        kind: {
          enum: ['subagent_result'],
          type: 'string',
        },
      },
      required: ['kind'],
      type: 'object',
    },
    MothershipStreamV1SubagentSpanEndEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1SubagentSpanEndPayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['span'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1SubagentSpanEndPayload: {
      additionalProperties: false,
      properties: {
        agent: {
          type: 'string',
        },
        data: true,
        event: {
          enum: ['end'],
          type: 'string',
        },
        kind: {
          enum: ['subagent'],
          type: 'string',
        },
      },
      required: ['kind', 'event'],
      type: 'object',
    },
    MothershipStreamV1SubagentSpanStartEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1SubagentSpanStartPayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['span'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1SubagentSpanStartPayload: {
      additionalProperties: false,
      properties: {
        agent: {
          type: 'string',
        },
        data: true,
        event: {
          enum: ['start'],
          type: 'string',
        },
        kind: {
          enum: ['subagent'],
          type: 'string',
        },
      },
      required: ['kind', 'event'],
      type: 'object',
    },
    MothershipStreamV1TextChannel: {
      enum: ['assistant', 'thinking'],
      type: 'string',
    },
    MothershipStreamV1TextEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1TextPayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['text'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1TextPayload: {
      additionalProperties: false,
      properties: {
        channel: {
          $ref: '#/$defs/MothershipStreamV1TextChannel',
        },
        text: {
          type: 'string',
        },
      },
      required: ['channel', 'text'],
      type: 'object',
    },
    MothershipStreamV1ToolArgsDeltaEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1ToolArgsDeltaPayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['tool'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1ToolArgsDeltaPayload: {
      additionalProperties: false,
      properties: {
        argumentsDelta: {
          type: 'string',
        },
        executor: {
          $ref: '#/$defs/MothershipStreamV1ToolExecutor',
        },
        mode: {
          $ref: '#/$defs/MothershipStreamV1ToolMode',
        },
        phase: {
          enum: ['args_delta'],
          type: 'string',
        },
        toolCallId: {
          type: 'string',
        },
        toolName: {
          type: 'string',
        },
      },
      required: ['toolCallId', 'toolName', 'argumentsDelta', 'executor', 'mode', 'phase'],
      type: 'object',
    },
    MothershipStreamV1ToolCallDescriptor: {
      additionalProperties: false,
      properties: {
        arguments: {
          $ref: '#/$defs/MothershipStreamV1AdditionalPropertiesMap',
        },
        executor: {
          $ref: '#/$defs/MothershipStreamV1ToolExecutor',
        },
        mode: {
          $ref: '#/$defs/MothershipStreamV1ToolMode',
        },
        partial: {
          type: 'boolean',
        },
        phase: {
          enum: ['call'],
          type: 'string',
        },
        requiresConfirmation: {
          type: 'boolean',
        },
        status: {
          $ref: '#/$defs/MothershipStreamV1ToolStatus',
        },
        toolCallId: {
          type: 'string',
        },
        toolName: {
          type: 'string',
        },
        ui: {
          $ref: '#/$defs/MothershipStreamV1ToolUI',
        },
      },
      required: ['toolCallId', 'toolName', 'executor', 'mode', 'phase'],
      type: 'object',
    },
    MothershipStreamV1ToolCallEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1ToolCallDescriptor',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['tool'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1ToolExecutor: {
      enum: ['go', 'sim', 'client'],
      type: 'string',
    },
    MothershipStreamV1ToolMode: {
      enum: ['sync', 'async'],
      type: 'string',
    },
    MothershipStreamV1ToolOutcome: {
      enum: ['success', 'error', 'cancelled', 'skipped', 'rejected'],
      type: 'string',
    },
    MothershipStreamV1ToolPhase: {
      enum: ['call', 'args_delta', 'result'],
      type: 'string',
    },
    MothershipStreamV1ToolResultEventEnvelope: {
      additionalProperties: false,
      properties: {
        payload: {
          $ref: '#/$defs/MothershipStreamV1ToolResultPayload',
        },
        scope: {
          $ref: '#/$defs/MothershipStreamV1StreamScope',
        },
        seq: {
          type: 'integer',
        },
        stream: {
          $ref: '#/$defs/MothershipStreamV1StreamRef',
        },
        trace: {
          $ref: '#/$defs/MothershipStreamV1Trace',
        },
        ts: {
          type: 'string',
        },
        type: {
          enum: ['tool'],
          type: 'string',
        },
        v: {
          enum: [1],
          type: 'integer',
        },
      },
      required: ['v', 'seq', 'ts', 'stream', 'type', 'payload'],
      type: 'object',
    },
    MothershipStreamV1ToolResultPayload: {
      additionalProperties: false,
      properties: {
        error: {
          type: 'string',
        },
        executor: {
          $ref: '#/$defs/MothershipStreamV1ToolExecutor',
        },
        mode: {
          $ref: '#/$defs/MothershipStreamV1ToolMode',
        },
        output: true,
        phase: {
          enum: ['result'],
          type: 'string',
        },
        status: {
          $ref: '#/$defs/MothershipStreamV1ToolStatus',
        },
        success: {
          type: 'boolean',
        },
        toolCallId: {
          type: 'string',
        },
        toolName: {
          type: 'string',
        },
      },
      required: ['toolCallId', 'toolName', 'executor', 'mode', 'phase', 'success'],
      type: 'object',
    },
    MothershipStreamV1ToolStatus: {
      enum: ['generating', 'executing', 'success', 'error', 'cancelled', 'skipped', 'rejected'],
      type: 'string',
    },
    MothershipStreamV1ToolUI: {
      additionalProperties: false,
      properties: {
        clientExecutable: {
          type: 'boolean',
        },
        hidden: {
          type: 'boolean',
        },
        icon: {
          type: 'string',
        },
        internal: {
          type: 'boolean',
        },
        phaseLabel: {
          type: 'string',
        },
        requiresConfirmation: {
          type: 'boolean',
        },
        title: {
          type: 'string',
        },
      },
      type: 'object',
    },
    MothershipStreamV1Trace: {
      additionalProperties: false,
      properties: {
        requestId: {
          type: 'string',
        },
        spanId: {
          type: 'string',
        },
      },
      required: ['requestId'],
      type: 'object',
    },
    MothershipStreamV1UsageData: {
      additionalProperties: false,
      properties: {
        cache_creation_input_tokens: {
          type: 'integer',
        },
        cache_read_input_tokens: {
          type: 'integer',
        },
        input_tokens: {
          type: 'integer',
        },
        model: {
          type: 'string',
        },
        output_tokens: {
          type: 'integer',
        },
        total_tokens: {
          type: 'integer',
        },
      },
      type: 'object',
    },
  },
  $id: 'mothership-stream-v1.schema.json',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  description: 'Shared execution-oriented mothership stream contract from Go to Sim.',
  oneOf: [
    {
      $ref: '#/$defs/MothershipStreamV1SessionStartEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1SessionChatEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1SessionTitleEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1SessionTraceEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1TextEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1ToolCallEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1ToolArgsDeltaEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1ToolResultEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1SubagentSpanStartEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1SubagentSpanEndEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1StructuredResultSpanEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1SubagentResultSpanEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1ResourceUpsertEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1ResourceRemoveEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1CheckpointPauseEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1RunResumedEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1CompactionStartEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1CompactionDoneEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1ErrorEventEnvelope',
    },
    {
      $ref: '#/$defs/MothershipStreamV1CompleteEventEnvelope',
    },
  ],
  title: 'MothershipStreamV1EventEnvelope',
}
