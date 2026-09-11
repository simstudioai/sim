// AUTO-GENERATED FILE. DO NOT EDIT.
// Generated from copilot/contracts/tool-catalog-v1.json
//

export type JsonSchema = unknown

export interface ToolRuntimeSchemaEntry {
  parameters?: JsonSchema
  resultSchema?: JsonSchema
}

export const TOOL_RUNTIME_SCHEMAS: Record<string, ToolRuntimeSchemaEntry> = {
  apply_file_edit: {
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'The text content to write. For append: text to append. For update: full replacement text. For patch with search_replace: the replacement text. For patch with anchored: the insert/replacement text.',
        },
      },
      required: ['content'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description:
            'Optional operation metadata such as file id, file name, size, and content type.',
        },
        message: {
          type: 'string',
          description: 'Human-readable summary of the outcome.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the content was applied successfully.',
        },
      },
      required: ['success', 'message'],
    },
  },
  auth: {
    parameters: {
      properties: {
        request: {
          description: 'What authentication/credential action is needed.',
          type: 'string',
        },
      },
      required: ['request'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  browser: {
    parameters: {
      properties: {
        sessionId: {
          description:
            'Reusable session ID returned by an earlier browser call in this chat. Supply it only on a later user message that continues the same browsing objective, and at most once per user message.',
          type: 'string',
        },
        task: {
          description:
            "Optional brief scoping instruction that the conversation does not already convey. Do not restate the user's request.",
          type: 'string',
        },
        title: {
          description:
            "Required private orchestration label (3–8 words) for this Browser Agent session's stable objective. When resuming with sessionId, copy the registry title unchanged.",
          maxLength: 120,
          minLength: 1,
          type: 'string',
        },
      },
      required: ['title'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  browser_click: {
    parameters: {
      type: 'object',
      properties: {
        elementId: {
          type: 'number',
          description:
            "The element id to act on (from the current tab's most recent browser_snapshot). Treat refs as invalid across tab switches or later snapshots.",
        },
      },
      required: ['elementId'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        activation: {
          type: 'string',
          description: 'native-pointer, native-keyboard, or synthetic-pointer.',
        },
        activeTab: {
          type: 'object',
          description: 'New active tab after a tab-changing click.',
          properties: {
            tabId: {
              type: 'string',
              description: 'Stable browser tab id.',
            },
            url: {
              type: 'string',
              description: 'New active tab URL.',
            },
          },
        },
        dialogs: {
          type: 'array',
          description: 'Visible DOM dialogs remaining after the click.',
          items: {
            type: 'string',
          },
        },
        dispatched: {
          type: 'boolean',
          description: 'Whether input dispatch completed.',
        },
        effect: {
          type: 'object',
          description:
            'Detailed postcondition signals; generic title/DOM/scroll churn is weak evidence unless the tool documents otherwise.',
          properties: {
            dialogChanged: {
              type: 'boolean',
              description: 'The visible DOM dialog set changed.',
            },
            domChanged: {
              type: 'boolean',
              description: 'The DOM mutation revision changed; weak evidence on its own.',
            },
            fieldChanged: {
              type: 'boolean',
              description: 'The safely inspectable focused-field state changed.',
            },
            focusChanged: {
              type: 'boolean',
              description: 'The focused element changed.',
            },
            popupChanged: {
              type: 'boolean',
              description: 'The visible popup/menu set changed.',
            },
            scrollChanged: {
              type: 'boolean',
              description: 'A tracked scroll offset changed; weak evidence except for scroll keys.',
            },
            tabChanged: {
              type: 'boolean',
              description: 'The active browser tab changed.',
            },
            targetChanged: {
              type: 'boolean',
              description: "The requested target's checked/selected/expanded/open state changed.",
            },
            titleChanged: {
              type: 'boolean',
              description: 'The document title changed; weak evidence on its own.',
            },
            urlChanged: {
              type: 'boolean',
              description: 'The observed URL changed.',
            },
          },
        },
        effectObserved: {
          type: 'boolean',
          description:
            'Whether a URL/tab/dialog/popup/target-state change, or editable-target focus change, was observed.',
        },
        element: {
          type: 'string',
          description: 'Resolved target element kind.',
        },
        note: {
          type: 'string',
          description: 'Postcondition or recovery guidance.',
        },
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        obstructedAfterNavigation: {
          type: 'boolean',
          description: 'Navigation/tab change occurred while a visible DOM dialog remained.',
        },
        possibleEffectObserved: {
          type: 'boolean',
          description: 'Includes weak title/DOM/scroll churn; never treat this alone as success.',
        },
        refRecovered: {
          type: 'boolean',
          description:
            'Whether a stale detached ref was safely rebound to one unique semantic match.',
        },
        trusted: {
          type: 'boolean',
          description: 'Whether Chromium trusted pointer/keyboard input was used.',
        },
      },
      required: ['dispatched'],
    },
  },
  browser_click_at: {
    parameters: {
      type: 'object',
      properties: {
        clickCount: {
          type: 'number',
          description: '1 = single click (default), 2 = double-click, 3 = triple-click.',
        },
        x: {
          type: 'number',
          description:
            'X in CSS pixels within the current viewport. When read off a browser_screenshot, divide the image pixel value by scale and add clip.x when present.',
        },
        y: {
          type: 'number',
          description:
            'Y in CSS pixels within the current viewport, converted from screenshot pixels the same way as x.',
        },
      },
      required: ['x', 'y'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        activeTab: {
          type: 'object',
          description: 'New active tab after a tab-changing click.',
          properties: {
            tabId: {
              type: 'string',
              description: 'Stable browser tab id.',
            },
            url: {
              type: 'string',
              description: 'New active tab URL.',
            },
          },
        },
        clickCount: {
          type: 'number',
          description: 'The click count that was dispatched (1, 2, or 3).',
        },
        clickedAt: {
          type: 'object',
          description: 'The CSS-pixel viewport point that was clicked.',
          properties: {
            x: {
              type: 'number',
              description: 'Clicked X in CSS viewport pixels.',
            },
            y: {
              type: 'number',
              description: 'Clicked Y in CSS viewport pixels.',
            },
          },
        },
        dialogs: {
          type: 'array',
          description: 'Visible DOM dialogs remaining after the click.',
          items: {
            type: 'string',
          },
        },
        dispatched: {
          type: 'boolean',
          description: 'Whether the native pointer click was dispatched at the point.',
        },
        effect: {
          type: 'object',
          description:
            'Detailed postcondition signals; generic title/DOM/scroll churn is weak evidence unless the tool documents otherwise.',
          properties: {
            dialogChanged: {
              type: 'boolean',
              description: 'The visible DOM dialog set changed.',
            },
            domChanged: {
              type: 'boolean',
              description: 'The DOM mutation revision changed; weak evidence on its own.',
            },
            fieldChanged: {
              type: 'boolean',
              description: 'The safely inspectable focused-field state changed.',
            },
            focusChanged: {
              type: 'boolean',
              description: 'The focused element changed.',
            },
            popupChanged: {
              type: 'boolean',
              description: 'The visible popup/menu set changed.',
            },
            scrollChanged: {
              type: 'boolean',
              description: 'A tracked scroll offset changed; weak evidence except for scroll keys.',
            },
            tabChanged: {
              type: 'boolean',
              description: 'The active browser tab changed.',
            },
            targetChanged: {
              type: 'boolean',
              description: "The requested target's checked/selected/expanded/open state changed.",
            },
            titleChanged: {
              type: 'boolean',
              description: 'The document title changed; weak evidence on its own.',
            },
            urlChanged: {
              type: 'boolean',
              description: 'The observed URL changed.',
            },
          },
        },
        effectObserved: {
          type: 'boolean',
          description:
            'Whether a strong page change (URL/dialog/popup/target, or focus into an editable) followed the click.',
        },
        note: {
          type: 'string',
          description: 'Caution or follow-up guidance, present when the click needs verification.',
        },
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        possibleEffectObserved: {
          type: 'boolean',
          description: 'Whether only weaker background churn (DOM/title) was observed.',
        },
        target: {
          type: 'string',
          description:
            'What the point resolved to before the click (tag/role and accessible name) — confirm it matches the intended target.',
        },
        targetCursor: {
          type: 'string',
          description:
            "The CSS cursor at the point (e.g. 'pointer', 'text', 'crosshair') — a hint about what kind of surface was hit.",
        },
        trusted: {
          type: 'boolean',
          description:
            'True — coordinate and drag input always use the trusted Chromium pointer pipeline.',
        },
      },
      required: ['dispatched'],
    },
  },
  browser_close_tab: {
    parameters: {
      type: 'object',
      properties: {
        tabId: {
          type: 'string',
          description: 'The id of the tab to close (from browser_list_tabs).',
        },
      },
      required: ['tabId'],
    },
    resultSchema: undefined,
  },
  browser_drag: {
    parameters: {
      type: 'object',
      properties: {
        fromElementId: {
          type: 'number',
          description:
            'Drag source element id from the latest snapshot. Alternative to fromX/fromY.',
        },
        fromX: {
          type: 'number',
          description:
            'Drag source X in CSS viewport pixels (paired with fromY) when no source element id is available.',
        },
        fromY: {
          type: 'number',
          description: 'Drag source Y in CSS viewport pixels.',
        },
        toElementId: {
          type: 'number',
          description: 'Drop target element id from the latest snapshot. Alternative to toX/toY.',
        },
        toX: {
          type: 'number',
          description: 'Drop target X in CSS viewport pixels (paired with toY).',
        },
        toY: {
          type: 'number',
          description: 'Drop target Y in CSS viewport pixels.',
        },
      },
    },
    resultSchema: {
      type: 'object',
      properties: {
        dialogs: {
          type: 'array',
          description: 'Visible DOM dialogs remaining after the click.',
          items: {
            type: 'string',
          },
        },
        dispatched: {
          type: 'boolean',
          description: 'Whether the full drag gesture was dispatched.',
        },
        effect: {
          type: 'object',
          description:
            'Detailed postcondition signals; generic title/DOM/scroll churn is weak evidence unless the tool documents otherwise.',
          properties: {
            dialogChanged: {
              type: 'boolean',
              description: 'The visible DOM dialog set changed.',
            },
            domChanged: {
              type: 'boolean',
              description: 'The DOM mutation revision changed; weak evidence on its own.',
            },
            fieldChanged: {
              type: 'boolean',
              description: 'The safely inspectable focused-field state changed.',
            },
            focusChanged: {
              type: 'boolean',
              description: 'The focused element changed.',
            },
            popupChanged: {
              type: 'boolean',
              description: 'The visible popup/menu set changed.',
            },
            scrollChanged: {
              type: 'boolean',
              description: 'A tracked scroll offset changed; weak evidence except for scroll keys.',
            },
            tabChanged: {
              type: 'boolean',
              description: 'The active browser tab changed.',
            },
            targetChanged: {
              type: 'boolean',
              description: "The requested target's checked/selected/expanded/open state changed.",
            },
            titleChanged: {
              type: 'boolean',
              description: 'The document title changed; weak evidence on its own.',
            },
            urlChanged: {
              type: 'boolean',
              description: 'The observed URL changed.',
            },
          },
        },
        effectObserved: {
          type: 'boolean',
          description:
            'Whether an observable page change (DOM/URL/dialog/target/scroll) followed the drag.',
        },
        from: {
          type: 'object',
          description: 'The resolved drag source.',
          properties: {
            element: {
              type: 'string',
              description: 'What that endpoint resolved to, when known.',
            },
            x: {
              type: 'number',
              description: 'Endpoint X in CSS viewport pixels.',
            },
            y: {
              type: 'number',
              description: 'Endpoint Y in CSS viewport pixels.',
            },
          },
        },
        nativeHtml5Drag: {
          type: 'boolean',
          description:
            'True when the page started a native HTML5 drag and it was completed as a real drag-and-drop; false for a pointer-sensor drag.',
        },
        note: {
          type: 'string',
          description:
            'Caution or follow-up guidance — e.g. verify the drop with a fresh snapshot when no effect was observed.',
        },
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        possibleEffectObserved: {
          type: 'boolean',
          description: 'Whether only weaker background churn (DOM/title) was observed.',
        },
        to: {
          type: 'object',
          description: 'The resolved drop target.',
          properties: {
            element: {
              type: 'string',
              description: 'What that endpoint resolved to, when known.',
            },
            x: {
              type: 'number',
              description: 'Endpoint X in CSS viewport pixels.',
            },
            y: {
              type: 'number',
              description: 'Endpoint Y in CSS viewport pixels.',
            },
          },
        },
        trusted: {
          type: 'boolean',
          description:
            'True — coordinate and drag input always use the trusted Chromium pointer pipeline.',
        },
      },
      required: ['dispatched'],
    },
  },
  browser_extract: {
    parameters: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description:
            'What you intend to extract, in plain language. Echoed back unchanged; it does not filter or shape the returned text.',
        },
      },
      required: ['instruction'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description: 'The extraction instruction echoed unchanged.',
        },
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        page: {
          type: 'object',
          description: 'Bounded visible page/frame text result.',
          properties: {
            framesRead: {
              type: 'number',
              description: 'Visible child frames whose text was appended.',
            },
            hiddenFrames: {
              type: 'number',
              description:
                'Eligible child frames skipped because their embedding surface was not visible.',
            },
            text: {
              type: 'string',
              description:
                'Visible text, capped across the top page and eligible visible child frames.',
            },
            title: {
              type: 'string',
              description: 'Top-page title when available.',
            },
            truncated: {
              type: 'boolean',
              description: 'Whether a page, frame, or combined character cap omitted text.',
            },
            unreadableFrames: {
              type: 'number',
              description: 'Eligible child frames whose text could not be read.',
            },
            url: {
              type: 'string',
              description: 'Top-page URL.',
            },
          },
        },
      },
    },
  },
  browser_fill_form: {
    parameters: {
      additionalProperties: false,
      properties: {
        fields: {
          description:
            "Ordered list of 1–8 fields with unique elementId refs from the current top page's latest snapshot. Supply exactly one matching value parameter per kind.",
          items: {
            oneOf: [
              {
                additionalProperties: false,
                properties: {
                  elementId: {},
                  kind: {
                    enum: ['text'],
                  },
                  text: {},
                },
                required: ['text'],
              },
              {
                additionalProperties: false,
                properties: {
                  elementId: {},
                  kind: {
                    enum: ['select'],
                  },
                  value: {},
                },
                required: ['value'],
              },
              {
                additionalProperties: false,
                properties: {
                  checked: {},
                  elementId: {},
                  kind: {
                    enum: ['checked'],
                  },
                },
                required: ['checked'],
              },
            ],
            properties: {
              checked: {
                description:
                  'Desired state for kind=checked. A radio can only be set true; native checkboxes may be true or false.',
                type: 'boolean',
              },
              elementId: {
                description:
                  "Nonnegative integer element ref from the current page's latest snapshot.",
                maximum: 9007199254740991,
                minimum: 0,
                type: 'integer',
              },
              kind: {
                description:
                  'text requires text; select requires value; checked requires checked. Do not supply parameters for another kind.',
                enum: ['text', 'select', 'checked'],
                type: 'string',
              },
              text: {
                description:
                  'Replacement content for kind=text, including empty to clear. At most 4096 characters. Ordinary input or textarea only.',
                maxLength: 4096,
                type: 'string',
              },
              value: {
                description:
                  'Option value or visible label for kind=select. At most 4096 characters. Native single-selection dropdown only.',
                maxLength: 4096,
                type: 'string',
              },
            },
            required: ['elementId', 'kind'],
            type: 'object',
          },
          maxItems: 8,
          minItems: 1,
          type: 'array',
        },
      },
      required: ['fields'],
      type: 'object',
    },
    resultSchema: {
      type: 'object',
      properties: {
        completed: {
          type: 'boolean',
          description:
            'True only when every requested field passed exact verification and the page boundary stayed unchanged.',
        },
        completedCount: {
          type: 'number',
          description:
            'Number of field results whose latest readback matched the requested state. Inspect results for the individual indices.',
        },
        doNotRetry: {
          type: 'boolean',
          description:
            'True when input dispatch began: inspect partial results and a fresh snapshot before deciding on remaining work; never blindly repeat the batch.',
        },
        error: {
          type: 'string',
          description: 'Reason filling stopped; preceding fields may already have taken effect.',
        },
        note: {
          type: 'string',
          description: 'Partial-outcome recovery guidance. Form filling is not atomic.',
        },
        notices: {
          type: 'array',
          items: {
            type: 'string',
          },
        },
        results: {
          type: 'array',
          description:
            'Ordered field readbacks. An interrupted write may have no result; absence is not proof that input had no effect.',
          items: {
            type: 'object',
            properties: {
              checked: {
                type: 'boolean',
              },
              elementId: {
                type: 'number',
              },
              index: {
                type: 'number',
              },
              kind: {
                type: 'string',
                enum: ['text', 'select', 'checked'],
              },
              redacted: {
                type: 'boolean',
              },
              valueLength: {
                type: 'number',
              },
              valuePreview: {
                type: 'string',
                description:
                  'Bounded normalized actual field preview, withheld for sensitive autocomplete fields; full-value equality is checked inside the page.',
              },
              verified: {
                type: 'boolean',
                description:
                  'Whether the full requested value or checked state matched at the latest successful probe, not merely whether input was dispatched.',
              },
            },
            required: ['index', 'elementId', 'kind', 'verified'],
          },
        },
        stoppedIndex: {
          type: 'number',
          description: 'Zero-based field index being processed or verified when filling stopped.',
        },
      },
      required: ['completed', 'completedCount', 'results'],
    },
  },
  browser_find: {
    parameters: {
      type: 'object',
      properties: {
        elementId: {
          type: 'number',
          description:
            'Optional current top-page element id to observe only that element and its subtree, such as a known form, row, or card. Returns scoped: true and fresh refs; all previous snapshot refs are invalidated. Cross-origin frame contents are omitted and mark the result truncated. Framed roots are rejected. Omit for a full-page snapshot or when the previous scope has disappeared.',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum matches to return (default 20, capped at 50).',
        },
        query: {
          type: 'string',
          description: 'Literal case-insensitive text to find in ref-bearing snapshot lines.',
        },
      },
      required: ['query'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        matches: {
          type: 'array',
          description: 'Bounded matching snapshot lines with valid element ids.',
          items: {
            type: 'object',
            properties: {
              elementId: {
                type: 'number',
                description: 'Fresh element id from the captured snapshot.',
              },
              line: {
                type: 'string',
                description: 'Matching ref-bearing snapshot line.',
              },
            },
          },
        },
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        query: {
          type: 'string',
          description: 'Literal query that was searched.',
        },
        scoped: {
          type: 'boolean',
          description: 'Whether observation was limited to the requested element subtree.',
        },
        title: {
          type: 'string',
          description: 'Top-page title when available.',
        },
        totalMatches: {
          type: 'number',
          description: 'Total matches before applying maxResults.',
        },
        truncated: {
          type: 'boolean',
          description: 'Whether snapshot coverage or matching results were truncated.',
        },
        url: {
          type: 'string',
          description: 'Top-page URL.',
        },
      },
      required: ['query', 'matches', 'totalMatches', 'truncated'],
    },
  },
  browser_go_back: {
    parameters: {
      type: 'object',
      properties: {},
    },
    resultSchema: undefined,
  },
  browser_go_forward: {
    parameters: {
      type: 'object',
      properties: {},
    },
    resultSchema: undefined,
  },
  browser_hover: {
    parameters: {
      type: 'object',
      properties: {
        elementId: {
          type: 'number',
          description:
            "The element id to act on (from the current tab's most recent browser_snapshot). Treat refs as invalid across tab switches or later snapshots.",
        },
      },
      required: ['elementId'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        effect: {
          type: 'object',
          description:
            'Detailed postcondition signals; generic title/DOM/scroll churn is weak evidence unless the tool documents otherwise.',
          properties: {
            dialogChanged: {
              type: 'boolean',
              description: 'The visible DOM dialog set changed.',
            },
            domChanged: {
              type: 'boolean',
              description: 'The DOM mutation revision changed; weak evidence on its own.',
            },
            fieldChanged: {
              type: 'boolean',
              description: 'The safely inspectable focused-field state changed.',
            },
            focusChanged: {
              type: 'boolean',
              description: 'The focused element changed.',
            },
            popupChanged: {
              type: 'boolean',
              description: 'The visible popup/menu set changed.',
            },
            scrollChanged: {
              type: 'boolean',
              description: 'A tracked scroll offset changed; weak evidence except for scroll keys.',
            },
            tabChanged: {
              type: 'boolean',
              description: 'The active browser tab changed.',
            },
            targetChanged: {
              type: 'boolean',
              description: "The requested target's checked/selected/expanded/open state changed.",
            },
            titleChanged: {
              type: 'boolean',
              description: 'The document title changed; weak evidence on its own.',
            },
            urlChanged: {
              type: 'boolean',
              description: 'The observed URL changed.',
            },
          },
        },
        effectObserved: {
          type: 'boolean',
          description: 'Whether a URL/dialog/popup/target-state change was observed.',
        },
        element: {
          type: 'string',
          description: 'Resolved target element kind when available.',
        },
        hovered: {
          type: 'boolean',
          description: 'Whether hover input was dispatched.',
        },
        note: {
          type: 'string',
          description: 'Guidance when no tooltip/menu was confirmed.',
        },
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        possibleEffectObserved: {
          type: 'boolean',
          description: 'Includes weak title/DOM/scroll churn; not proof of success.',
        },
        refRecovered: {
          type: 'boolean',
          description:
            'Whether a stale detached ref was safely rebound to one unique semantic match.',
        },
        trusted: {
          type: 'boolean',
          description: 'Whether Chromium trusted pointer movement was used.',
        },
      },
      required: ['hovered'],
    },
  },
  browser_insert_text: {
    parameters: {
      type: 'object',
      properties: {
        submit: {
          type: 'boolean',
          description: 'Press Enter after inserting. Default false.',
        },
        text: {
          type: 'string',
          description: 'The text to insert at the caret. Must be non-empty.',
        },
      },
      required: ['text'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        activeElement: {
          type: 'string',
          description: 'Focused element kind after the action.',
        },
        dispatched: {
          type: 'boolean',
          description: 'Whether the text was inserted through the native IME pipeline.',
        },
        effect: {
          type: 'object',
          description:
            'Detailed postcondition signals; generic title/DOM/scroll churn is weak evidence unless the tool documents otherwise.',
          properties: {
            dialogChanged: {
              type: 'boolean',
              description: 'The visible DOM dialog set changed.',
            },
            domChanged: {
              type: 'boolean',
              description: 'The DOM mutation revision changed; weak evidence on its own.',
            },
            fieldChanged: {
              type: 'boolean',
              description: 'The safely inspectable focused-field state changed.',
            },
            focusChanged: {
              type: 'boolean',
              description: 'The focused element changed.',
            },
            popupChanged: {
              type: 'boolean',
              description: 'The visible popup/menu set changed.',
            },
            scrollChanged: {
              type: 'boolean',
              description: 'A tracked scroll offset changed; weak evidence except for scroll keys.',
            },
            tabChanged: {
              type: 'boolean',
              description: 'The active browser tab changed.',
            },
            targetChanged: {
              type: 'boolean',
              description: "The requested target's checked/selected/expanded/open state changed.",
            },
            titleChanged: {
              type: 'boolean',
              description: 'The document title changed; weak evidence on its own.',
            },
            urlChanged: {
              type: 'boolean',
              description: 'The observed URL changed.',
            },
          },
        },
        effectObserved: {
          type: 'boolean',
          description:
            'Whether a field or page change confirmed the insertion. Canvas editors cannot echo one — verify visually.',
        },
        insertedChars: {
          type: 'number',
          description: 'How many characters were inserted.',
        },
        kind: {
          type: 'string',
          description:
            'The kind of focused editable that received the text (input:*, textarea, contenteditable, canvas, textbox-role).',
        },
        note: {
          type: 'string',
          description:
            'Caution or follow-up guidance, e.g. that a canvas editor needs visual verification.',
        },
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        possibleEffectObserved: {
          type: 'boolean',
          description: 'Whether only weaker background churn was observed.',
        },
        redacted: {
          type: 'boolean',
          description: 'Whether sensitive focused-field details were withheld.',
        },
        selectedChars: {
          type: 'number',
          description: 'Number of selected characters when safely inspectable.',
        },
        submitDispatched: {
          type: 'boolean',
          description: 'Whether Enter was actually dispatched.',
        },
        submitRequested: {
          type: 'boolean',
          description: 'Whether Enter was requested after insertion.',
        },
        trusted: {
          type: 'boolean',
          description: 'True — insertion uses the trusted input pipeline.',
        },
        valueLength: {
          type: 'number',
          description: 'Focused non-secret field length when safely inspectable.',
        },
        valuePreview: {
          type: 'string',
          description: 'Bounded focused non-secret field preview when safely inspectable.',
        },
      },
      required: ['dispatched'],
    },
  },
  browser_list_downloads: {
    parameters: {
      type: 'object',
      properties: {},
    },
    resultSchema: {
      type: 'object',
      properties: {
        downloads: {
          type: 'array',
          description: 'Recent downloads for this browser session, newest first.',
          items: {
            type: 'object',
            properties: {
              filename: {
                type: 'string',
                description: 'Sanitized filename; no local filesystem path is exposed.',
              },
              id: {
                type: 'string',
                description: 'Session-local download id.',
              },
              receivedBytes: {
                type: 'number',
                description: 'Bytes received so far.',
              },
              startedAt: {
                type: 'string',
                description: 'ISO timestamp when the download started.',
              },
              state: {
                type: 'string',
                description: 'Current download lifecycle state.',
                enum: ['progressing', 'completed', 'interrupted', 'cancelled'],
              },
              totalBytes: {
                type: 'number',
                description: 'Expected total bytes when known, otherwise zero.',
              },
            },
          },
        },
        scopeId: {
          type: 'string',
          description: 'Browser session scope that owns these downloads.',
        },
      },
      required: ['downloads', 'scopeId'],
    },
  },
  browser_list_sessions: {
    parameters: {
      type: 'object',
      properties: {},
    },
    resultSchema: undefined,
  },
  browser_list_tabs: {
    parameters: {
      type: 'object',
      properties: {},
    },
    resultSchema: undefined,
  },
  browser_navigate: {
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'The absolute URL to navigate to, including scheme (https:// or http://). Public websites and localhost/loopback are supported; other private/internal hosts are rejected.',
        },
      },
      required: ['url'],
    },
    resultSchema: undefined,
  },
  browser_open_tab: {
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Optional URL to open the new tab at.',
        },
      },
    },
    resultSchema: undefined,
  },
  browser_open_url: {
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'The absolute URL to open, including scheme (https:// or http:// — localhost/local dev URLs are supported).',
        },
      },
      required: ['url'],
    },
    resultSchema: undefined,
  },
  browser_press_key: {
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description:
            "Key or combination. Named keys (case-insensitive): Enter, Escape (Esc), Tab, Backspace, Delete, Space, ArrowUp/ArrowDown/ArrowLeft/ArrowRight (or Up/Down/Left/Right), Home, End, PageUp, PageDown. Any single character also works ('a', '5', '/', ','). Anything else — 'F5', 'Return', 'Insert' — is rejected. Join modifiers with '+'. Use Mod (aliases Primary, ControlOrMeta, CommandOrControl) for the platform primary modifier, e.g. Mod+K or Mod+,. Raw Control/Ctrl and Cmd/Command/Meta remain available; Control is not generally Cmd on macOS. Check effectObserved and primaryModifier in the result.",
        },
      },
      required: ['key'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        activeElement: {
          type: 'string',
          description: 'Focused element kind after the action.',
        },
        dialogs: {
          type: 'array',
          description: 'Visible DOM dialogs after the key.',
          items: {
            type: 'string',
          },
        },
        effect: {
          type: 'object',
          description:
            'Detailed postcondition signals; generic title/DOM/scroll churn is weak evidence unless the tool documents otherwise.',
          properties: {
            dialogChanged: {
              type: 'boolean',
              description: 'The visible DOM dialog set changed.',
            },
            domChanged: {
              type: 'boolean',
              description: 'The DOM mutation revision changed; weak evidence on its own.',
            },
            fieldChanged: {
              type: 'boolean',
              description: 'The safely inspectable focused-field state changed.',
            },
            focusChanged: {
              type: 'boolean',
              description: 'The focused element changed.',
            },
            popupChanged: {
              type: 'boolean',
              description: 'The visible popup/menu set changed.',
            },
            scrollChanged: {
              type: 'boolean',
              description: 'A tracked scroll offset changed; weak evidence except for scroll keys.',
            },
            tabChanged: {
              type: 'boolean',
              description: 'The active browser tab changed.',
            },
            targetChanged: {
              type: 'boolean',
              description: "The requested target's checked/selected/expanded/open state changed.",
            },
            titleChanged: {
              type: 'boolean',
              description: 'The document title changed; weak evidence on its own.',
            },
            urlChanged: {
              type: 'boolean',
              description: 'The observed URL changed.',
            },
          },
        },
        effectObserved: {
          type: 'boolean',
          description: 'A strong targeted effect was observed.',
        },
        note: {
          type: 'string',
          description: 'No-op/fallback guidance.',
        },
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        possibleEffectObserved: {
          type: 'boolean',
          description: 'Includes weak title/DOM/scroll churn; not proof of success.',
        },
        pressed: {
          type: 'string',
          description: 'Requested key/combo whose dispatch completed.',
        },
        primaryModifier: {
          type: 'string',
          description: 'Cmd on macOS, Control elsewhere.',
        },
        redacted: {
          type: 'boolean',
          description: 'Whether sensitive focused-field details were withheld.',
        },
        selectedChars: {
          type: 'number',
          description: 'Number of selected characters when safely inspectable.',
        },
        target: {
          type: 'string',
          description: 'Synthetic fallback target element kind, when applicable.',
        },
        trusted: {
          type: 'boolean',
          description: 'Whether Chromium trusted key input was used.',
        },
        valueLength: {
          type: 'number',
          description: 'Focused non-secret field length when safely inspectable.',
        },
        valuePreview: {
          type: 'string',
          description: 'Bounded focused non-secret field preview when safely inspectable.',
        },
      },
      required: ['pressed'],
    },
  },
  browser_read_text: {
    parameters: {
      type: 'object',
      properties: {
        elementId: {
          type: 'number',
          description:
            "Optional element id from the current tab's most recent browser_snapshot. Treat refs as invalid across tab switches or later snapshots. Omit to read the whole page.",
        },
      },
    },
    resultSchema: {
      type: 'object',
      properties: {
        framesRead: {
          type: 'number',
          description: 'Visible child frames whose text was appended.',
        },
        hiddenFrames: {
          type: 'number',
          description:
            'Eligible child frames skipped because their embedding surface was not visible.',
        },
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        text: {
          type: 'string',
          description:
            'Visible text, capped across the top page and eligible visible child frames.',
        },
        title: {
          type: 'string',
          description: 'Top-page title when available.',
        },
        truncated: {
          type: 'boolean',
          description: 'Whether a page, frame, or combined character cap omitted text.',
        },
        unreadableFrames: {
          type: 'number',
          description: 'Eligible child frames whose text could not be read.',
        },
        url: {
          type: 'string',
          description: 'Top-page URL.',
        },
      },
    },
  },
  browser_reload: {
    parameters: {
      type: 'object',
      properties: {},
    },
    resultSchema: {
      type: 'object',
      properties: {
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        title: {
          type: 'string',
          description: 'Top-page title when available.',
        },
        url: {
          type: 'string',
          description: 'Top-page URL.',
        },
      },
      required: ['url', 'title'],
    },
  },
  browser_screenshot: {
    parameters: {
      type: 'object',
      properties: {
        elementId: {
          type: 'number',
          description:
            "Optional element id from the current tab's latest browser_snapshot. When present, capture only the visible portion of that top-page element without scrolling or changing layout. Scroll explicitly first if needed. Framed elements are rejected; use a viewport screenshot for them. Use the returned clip offset when converting image coordinates.",
        },
      },
    },
    resultSchema: undefined,
  },
  browser_scroll: {
    parameters: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description:
            'Optional distance to scroll in pixels (default: 85% of the viewport height for up/down or width for left/right, so a little context carries over).',
        },
        direction: {
          type: 'string',
          description: 'Scroll direction.',
          enum: ['up', 'down', 'left', 'right'],
        },
        elementId: {
          type: 'number',
          description:
            "The element id to act on (from the current tab's most recent browser_snapshot). Treat refs as invalid across tab switches or later snapshots.",
        },
      },
      required: ['direction'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        atBottom: {
          type: 'boolean',
          description: 'Whether the selected region is at its bottom boundary.',
        },
        atLeft: {
          type: 'boolean',
          description:
            'Whether the selected region is at its physical left boundary, included for left/right.',
        },
        atRight: {
          type: 'boolean',
          description:
            'Whether the selected region is at its physical right boundary, included for left/right.',
        },
        atTop: {
          type: 'boolean',
          description: 'Whether the selected region is at its top boundary.',
        },
        clientHeight: {
          type: 'number',
          description: 'Region viewport height.',
        },
        clientWidth: {
          type: 'number',
          description: 'Region viewport width, included for left/right.',
        },
        movedBy: {
          type: 'number',
          description:
            'Actual signed movement on the requested axis: negative for up/left, positive for down/right; zero means the target did not move.',
        },
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        scrollHeight: {
          type: 'number',
          description: 'Region content height.',
        },
        scrollLeft: {
          type: 'number',
          description:
            'Resulting horizontal region scroll offset, included for left/right; may be negative in right-to-left regions.',
        },
        scrollTop: {
          type: 'number',
          description: 'Resulting vertical region scroll offset.',
        },
        scrollWidth: {
          type: 'number',
          description: 'Region content width, included for left/right.',
        },
        target: {
          type: 'string',
          description: 'Chosen scroll region label.',
        },
        targetSource: {
          type: 'string',
          description:
            'element, element-boundary, focus, focus-boundary, viewport-center, viewport-center-boundary, largest-visible, or page.',
        },
        windowScrollX: {
          type: 'number',
          description: 'Top-page horizontal window scroll offset after a left/right region scroll.',
        },
        windowScrollY: {
          type: 'number',
          description: 'Top-page vertical window scroll offset after the region scroll.',
        },
      },
      required: ['atTop', 'atBottom'],
    },
  },
  browser_select_option: {
    parameters: {
      type: 'object',
      properties: {
        elementId: {
          type: 'number',
          description:
            "The element id to act on (from the current tab's most recent browser_snapshot). Treat refs as invalid across tab switches or later snapshots.",
        },
        value: {
          type: 'string',
          description: "The option's visible label or its value.",
        },
      },
      required: ['elementId', 'value'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        effectObserved: {
          type: 'boolean',
          description: 'Whether the settled readback retained the requested selection.',
        },
        note: {
          type: 'string',
          description: 'Guidance when the page reverted the selection.',
        },
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        readback: {
          type: 'object',
          description: 'Settled selected label and value.',
          properties: {
            selected: {
              type: 'string',
              description: 'Settled visible option label.',
            },
            value: {
              type: 'string',
              description: 'Settled option value.',
            },
          },
        },
        refRecovered: {
          type: 'boolean',
          description:
            'Whether a stale detached ref was safely rebound to one unique semantic match.',
        },
        selected: {
          type: 'string',
          description: 'Canonical visible label of the matched option.',
        },
        value: {
          type: 'string',
          description: 'Canonical value of the matched option.',
        },
      },
      required: ['selected'],
    },
  },
  browser_set_checked: {
    parameters: {
      type: 'object',
      properties: {
        checked: {
          type: 'boolean',
          description:
            'Desired checked state. Radio buttons cannot be unchecked directly; select another radio in the group instead.',
        },
        elementId: {
          type: 'number',
          description:
            "The element id to act on (from the current tab's most recent browser_snapshot). Treat refs as invalid across tab switches or later snapshots.",
        },
      },
      required: ['elementId', 'checked'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        changed: {
          type: 'boolean',
          description: 'Whether the control needed to change.',
        },
        checked: {
          type: 'boolean',
          description: 'Settled checked state after the operation.',
        },
        dispatched: {
          type: 'boolean',
          description: 'Whether input was dispatched.',
        },
        element: {
          type: 'string',
          description: 'Resolved checkable control kind.',
        },
        note: {
          type: 'string',
          description: 'Readback or follow-up guidance.',
        },
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        refRecovered: {
          type: 'boolean',
          description:
            'Whether a stale detached ref was safely rebound to one unique semantic match.',
        },
        trusted: {
          type: 'boolean',
          description: "Whether Chromium's trusted pointer pipeline dispatched the change.",
        },
      },
      required: ['checked', 'changed', 'dispatched'],
    },
  },
  browser_snapshot: {
    parameters: {
      type: 'object',
      properties: {
        elementId: {
          type: 'number',
          description:
            'Optional current top-page element id to observe only that element and its subtree, such as a known form, row, or card. Returns scoped: true and fresh refs; all previous snapshot refs are invalidated. Cross-origin frame contents are omitted and mark the result truncated. Framed roots are rejected. Omit for a full-page snapshot or when the previous scope has disappeared.',
        },
      },
    },
    resultSchema: {
      type: 'object',
      properties: {
        capturedCrossOriginFrames: {
          type: 'number',
          description: 'Number of non-empty eligible cross-origin frames appended.',
        },
        hiddenCrossOriginFrames: {
          type: 'number',
          description:
            'Eligible cross-origin frames skipped because their embedding surface was hidden, offscreen, or covered.',
        },
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        outline: {
          type: 'string',
          description: 'Mounted DOM/frame outline containing model-visible [ref=N] ids.',
        },
        pageHeight: {
          type: 'number',
          description: 'Top-page document height.',
        },
        scoped: {
          type: 'boolean',
          description: 'Whether observation was limited to the requested element subtree.',
        },
        scrollY: {
          type: 'number',
          description: 'Top-page window scroll offset.',
        },
        title: {
          type: 'string',
          description: 'Captured top-page title.',
        },
        truncated: {
          type: 'boolean',
          description: 'True when page/ref/frame/combined output caps omitted content.',
        },
        unreadableCrossOriginFrames: {
          type: 'number',
          description: 'Eligible cross-origin frames that could not be captured.',
        },
        url: {
          type: 'string',
          description: 'Captured top-page URL.',
        },
        viewportHeight: {
          type: 'number',
          description: 'Top-page viewport height.',
        },
        viewportWidth: {
          type: 'number',
          description: 'Top-page viewport width.',
        },
      },
      required: ['outline', 'truncated'],
    },
  },
  browser_switch_tab: {
    parameters: {
      type: 'object',
      properties: {
        tabId: {
          type: 'string',
          description: 'The id of the tab to activate (from browser_list_tabs).',
        },
      },
      required: ['tabId'],
    },
    resultSchema: undefined,
  },
  browser_type: {
    parameters: {
      type: 'object',
      properties: {
        elementId: {
          type: 'number',
          description:
            "The element id to act on (from the current tab's most recent browser_snapshot). Treat refs as invalid across tab switches or later snapshots.",
        },
        submit: {
          type: 'boolean',
          description: 'Press Enter after typing. Default false.',
        },
        text: {
          type: 'string',
          description:
            "The text to type. Replaces the element's current content. Must be non-empty — an empty string is rejected as a missing parameter; to clear a field, press Mod+A then Backspace with browser_press_key.",
        },
      },
      required: ['elementId', 'text'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        activeElement: {
          type: 'string',
          description: 'Focused element kind after the action.',
        },
        dispatched: {
          type: 'boolean',
          description: 'Whether text dispatch completed.',
        },
        effect: {
          type: 'object',
          description:
            'Detailed postcondition signals; generic title/DOM/scroll churn is weak evidence unless the tool documents otherwise.',
          properties: {
            dialogChanged: {
              type: 'boolean',
              description: 'The visible DOM dialog set changed.',
            },
            domChanged: {
              type: 'boolean',
              description: 'The DOM mutation revision changed; weak evidence on its own.',
            },
            fieldChanged: {
              type: 'boolean',
              description: 'The safely inspectable focused-field state changed.',
            },
            focusChanged: {
              type: 'boolean',
              description: 'The focused element changed.',
            },
            popupChanged: {
              type: 'boolean',
              description: 'The visible popup/menu set changed.',
            },
            scrollChanged: {
              type: 'boolean',
              description: 'A tracked scroll offset changed; weak evidence except for scroll keys.',
            },
            tabChanged: {
              type: 'boolean',
              description: 'The active browser tab changed.',
            },
            targetChanged: {
              type: 'boolean',
              description: "The requested target's checked/selected/expanded/open state changed.",
            },
            titleChanged: {
              type: 'boolean',
              description: 'The document title changed; weak evidence on its own.',
            },
            urlChanged: {
              type: 'boolean',
              description: 'The observed URL changed.',
            },
          },
        },
        effectObserved: {
          type: 'boolean',
          description: 'A strong field/page effect was observed.',
        },
        note: {
          type: 'string',
          description: 'Postcondition guidance when readback did not prove a change.',
        },
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        possibleEffectObserved: {
          type: 'boolean',
          description: 'Includes weak title/DOM/scroll churn; not proof of success.',
        },
        redacted: {
          type: 'boolean',
          description: 'Whether sensitive focused-field details were withheld.',
        },
        refRecovered: {
          type: 'boolean',
          description:
            'Whether a stale detached ref was safely rebound to one unique semantic match.',
        },
        replacedExisting: {
          type: 'boolean',
          description: "Whether the operation replaced the field's existing content.",
        },
        selectedChars: {
          type: 'number',
          description: 'Number of selected characters when safely inspectable.',
        },
        submissionEffectObserved: {
          type: 'boolean',
          description:
            'Whether a strong effect was observed after Enter, separately from the text write.',
        },
        submitDispatched: {
          type: 'boolean',
          description:
            'Whether Enter dispatch acknowledged completion; this alone is not proof of submission.',
        },
        submitRequested: {
          type: 'boolean',
          description: 'Whether submit=true was requested.',
        },
        submitUncertain: {
          type: 'boolean',
          description:
            'Whether Enter key-down may have landed but dispatch did not acknowledge completion.',
        },
        submitted: {
          type: 'boolean',
          description:
            'Whether Enter dispatch completed and a strong submission effect was observed.',
        },
        trusted: {
          type: 'boolean',
          description: 'Whether native Chromium input was used.',
        },
        valueLength: {
          type: 'number',
          description: 'Focused non-secret field length when safely inspectable.',
        },
        valuePreview: {
          type: 'string',
          description: 'Bounded focused non-secret field preview when safely inspectable.',
        },
      },
      required: ['dispatched'],
    },
  },
  browser_wait_for: {
    parameters: {
      type: 'object',
      properties: {
        elementId: {
          type: 'number',
          description:
            "Optional top-page element id from the current tab's latest browser_snapshot. Supply with state to inspect that exact registered DOM node; waits do not recover replacement nodes. Framed refs and navigation during an element wait are rejected; use text/URL conditions for those flows.",
        },
        state: {
          type: 'string',
          description:
            'Optional semantic condition for elementId. attached/detached inspect DOM presence; visible/hidden inspect rendering; enabled/disabled include native and ARIA state; checked, expanded, and selected conditions inspect native or ARIA state. All supplied text, URL, and element conditions must pass.',
          enum: [
            'attached',
            'detached',
            'visible',
            'hidden',
            'enabled',
            'disabled',
            'checked',
            'unchecked',
            'expanded',
            'collapsed',
            'selected',
            'unselected',
          ],
        },
        text: {
          type: 'string',
          description: 'Optional visible text to wait for.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Maximum time to wait, in milliseconds (default 10000, capped at 120000).',
        },
        urlContains: {
          type: 'string',
          description: "Optional substring that the active tab's URL must contain.",
        },
      },
    },
    resultSchema: {
      type: 'object',
      properties: {
        elapsedMs: {
          type: 'number',
          description: 'Elapsed wait duration.',
        },
        found: {
          type: 'boolean',
          description: 'Whether every supplied wait condition passed before timeout.',
        },
        foundInFrame: {
          type: 'boolean',
          description: 'Whether the match was found in an eligible visible child frame.',
        },
        matched: {
          type: 'array',
          description: 'Condition categories that passed: text, url, and/or element.',
          items: {
            type: 'string',
          },
        },
        note: {
          type: 'string',
          description: 'Timeout or recovery guidance.',
        },
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        waitedMs: {
          type: 'number',
          description: 'Completed sleep duration when no text was requested.',
        },
      },
    },
  },
  browser_zoom: {
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Zoom action: in, out, or reset.',
          enum: ['in', 'out', 'reset'],
        },
      },
      required: ['action'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Applied zoom action.',
        },
        notices: {
          type: 'array',
          description:
            'Pending auto-handled JavaScript alert/confirm/prompt notices since the previous successful browser result.',
          items: {
            type: 'string',
          },
        },
        zoomPercent: {
          type: 'number',
          description: 'Settled tab zoom as a percentage.',
        },
      },
      required: ['action', 'zoomPercent'],
    },
  },
  call_integration_tool: {
    parameters: {
      properties: {
        arguments: {
          additionalProperties: true,
          description: "Inputs matching the selected operation's server-owned inputSchema.",
          type: 'object',
        },
        credentialId: {
          description:
            'Optional OAuth credential ID convenience field. It is injected into operation arguments when that schema accepts credentialId.',
          type: 'string',
        },
        description: {
          description:
            'Short base-form verb phrase describing this invocation, without the integration name (for example "Search for invoice emails").',
          type: 'string',
        },
        toolId: {
          description: 'Exact toolId returned by search_integration_tools.',
          type: 'string',
        },
      },
      required: ['toolId', 'description', 'arguments'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  cancel_workflow_run: {
    parameters: {
      type: 'object',
      properties: {
        executionId: {
          type: 'string',
          description:
            'Required workflow execution ID returned by run_workflow with async:true or found with query_logs. This identifies a workflow run, not an agent invocation or chat request.',
        },
      },
      required: ['executionId'],
    },
    resultSchema: undefined,
  },
  connect_slack_bot: {
    parameters: {
      type: 'object',
      properties: {
        botTokenEnvVar: {
          type: 'string',
          description:
            'NAME of the environment variable holding the bot token (xoxb-..., OAuth & Permissions → Bot User OAuth Token). Pass the variable name, never the token value.',
        },
        description: {
          type: 'string',
          description: 'Optional description shown on the credential.',
        },
        displayName: {
          type: 'string',
          description:
            'Display name for the credential, shown in the credential picker (e.g. "Elder Bot"). Must be unique in the workspace.',
        },
        signingSecretEnvVar: {
          type: 'string',
          description:
            "NAME of the environment variable holding the Slack app's signing secret (Basic Information → App Credentials). Pass the variable name, never the secret value.",
        },
      },
      required: ['displayName', 'signingSecretEnvVar', 'botTokenEnvVar'],
    },
    resultSchema: undefined,
  },
  cp: {
    parameters: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description:
            'Target path under workflows/. An existing folder (or a path ending in "/") duplicates sources into it keeping their names; otherwise the last segment names the copy and the preceding segments are the target folder (created automatically when missing).',
        },
        sources: {
          type: 'array',
          description:
            'Canonical workflow VFS paths to duplicate, e.g. ["workflows/My%20Workflow"]. Copy paths verbatim from glob/grep/read output.',
          items: {
            type: 'string',
          },
        },
        toolTitle: {
          type: 'string',
          description:
            'Target-only UI phrase for the action row, e.g. "My Workflow" or "Template to Archive", not a full sentence like "Copying My Workflow".',
        },
      },
      required: ['sources', 'destination', 'toolTitle'],
    },
    resultSchema: undefined,
  },
  create_empty_file: {
    parameters: {
      type: 'object',
      properties: {
        contentType: {
          type: 'string',
          description:
            'Optional MIME type override. Usually omit and let the system infer from the file extension.',
        },
        fileName: {
          type: 'string',
          description:
            'Backward-compatible workspace filename. Prefer outputs.files[0].path for new calls.',
        },
        outputs: {
          type: 'object',
          description: 'Workspace file output declarations using canonical VFS paths.',
          properties: {
            files: {
              type: 'array',
              description:
                'Files to create or overwrite. Missing parent folders are created automatically for create mode.',
              items: {
                type: 'object',
                properties: {
                  mimeType: {
                    type: 'string',
                    description: 'Optional MIME type override when inference is not enough.',
                  },
                  mode: {
                    type: 'string',
                    description: 'Create a new file or overwrite an existing file at path.',
                    enum: ['create', 'overwrite'],
                  },
                  path: {
                    type: 'string',
                    description: 'Canonical destination VFS path, e.g. "files/Reports/result.csv".',
                  },
                },
                required: ['path', 'mode'],
              },
            },
          },
        },
      },
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description:
            'Contains id (internal file ID), name, and vfsPath. Use vfsPath for follow-up file tools.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the file was created.',
        },
      },
      required: ['success', 'message'],
    },
  },
  create_workflow: {
    parameters: {
      type: 'object',
      properties: {
        folderPath: {
          type: 'string',
          description:
            'Optional canonical workflow-folder VFS path copied from glob("workflows/**"), for example "workflows/Dream" or "workflows/Client%20Work/Intake". Omit for the workspace root.',
        },
        name: {
          type: 'string',
          description: 'Workflow name.',
        },
        workspaceId: {
          type: 'string',
          description: 'Optional workspace ID.',
        },
      },
      required: ['name'],
    },
    resultSchema: undefined,
  },
  create_workspace_mcp_server: {
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Optional description for the server',
        },
        isPublic: {
          type: 'boolean',
          description: 'Whether the workflow MCP server is publicly accessible',
        },
        name: {
          type: 'string',
          description: 'Required: server name',
        },
        workflowIds: {
          type: 'array',
          description: 'Optional deployed workflow IDs to publish as tools on the new server',
          items: {
            type: 'string',
          },
        },
        workspaceId: {
          type: 'string',
          description:
            'Workspace ID. Required when no current workspace context is available, such as headless MCP calls.',
        },
      },
      required: ['name'],
    },
    resultSchema: undefined,
  },
  delete_workspace_mcp_server: {
    parameters: {
      type: 'object',
      properties: {
        serverId: {
          type: 'string',
          description: 'Required: the MCP server ID to delete',
        },
      },
      required: ['serverId'],
    },
    resultSchema: undefined,
  },
  deploy: {
    parameters: {
      properties: {
        request: {
          description:
            'Detailed deployment instructions. Include the deployment type and ALL user-specified options: identifier, title, description, authType, password, allowedEmails, welcomeMessage, outputConfigs (block outputs to display).',
          type: 'string',
        },
      },
      required: ['request'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  deploy_as_api: {
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Whether to deploy or undeploy the API endpoint',
          enum: ['deploy', 'undeploy'],
          default: 'deploy',
        },
        versionDescription: {
          type: 'string',
          description:
            'REQUIRED when action is "deploy": a concise (1-3 sentence) description of what changed in this deployment version, e.g. "Adds Slack failure alert and retries on the HTTP block". If unsure what changed, call diff_workflows(ref1: "live", ref2: "draft") first. Ignored for undeploy.',
        },
        versionName: {
          type: 'string',
          description:
            'REQUIRED when action is "deploy": a short human-readable name/label for this deployment version (shown in the deployment history), e.g. "v2 pricing" or "Add Slack alerts". Ignored for undeploy.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID to deploy (required in workspace context)',
        },
      },
    },
    resultSchema: {
      type: 'object',
      properties: {
        apiEndpoint: {
          type: 'string',
          description: 'Canonical workflow execution endpoint.',
        },
        baseUrl: {
          type: 'string',
          description: 'Base URL used to construct deployment URLs.',
        },
        deployedAt: {
          type: 'string',
          description: 'Deployment timestamp when the workflow is deployed.',
        },
        deploymentConfig: {
          type: 'object',
          description:
            'Structured deployment configuration keyed by surface name. For API deploys this includes endpoint, auth, and sync/stream/async mode details.',
        },
        deploymentStatus: {
          type: 'object',
          description:
            'Structured per-surface deployment status keyed by surface name, such as api.',
        },
        deploymentType: {
          type: 'string',
          description:
            'Deployment surface this result describes. For deploy_as_api and redeploy this is always "api".',
        },
        examples: {
          type: 'object',
          description:
            'Invocation examples keyed by surface name. For API deploys this includes curl examples for sync, stream, async, and polling.',
        },
        isDeployed: {
          type: 'boolean',
          description: 'Whether the workflow API is currently deployed after this tool call.',
        },
        version: {
          type: 'number',
          description: 'Deployment version for the current API deployment.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID that was deployed or undeployed.',
        },
      },
      required: [
        'workflowId',
        'isDeployed',
        'deploymentType',
        'deploymentStatus',
        'deploymentConfig',
        'examples',
      ],
    },
  },
  deploy_as_chat: {
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Whether to deploy or undeploy the chat interface',
          enum: ['deploy', 'undeploy'],
          default: 'deploy',
        },
        allowedEmails: {
          type: 'array',
          description: 'List of allowed emails/domains for email or SSO auth',
          items: {
            type: 'string',
          },
        },
        authType: {
          type: 'string',
          description: 'Authentication type: public, password, email, or sso',
          enum: ['public', 'password', 'email', 'sso'],
          default: 'public',
        },
        description: {
          type: 'string',
          description: 'Optional chat-facing description shown on the chat page',
        },
        identifier: {
          type: 'string',
          description: 'URL slug for the chat (lowercase letters, numbers, hyphens only)',
        },
        outputConfigs: {
          type: 'array',
          description: 'Output configurations specifying which block outputs to display in chat',
          items: {
            type: 'object',
            properties: {
              blockId: {
                type: 'string',
                description: 'The block UUID',
              },
              path: {
                type: 'string',
                description:
                  'The output path (e.g. `content` for an agent; structured fields are top-level paths). Call get_block_outputs for real paths.',
              },
            },
            required: ['blockId', 'path'],
          },
        },
        password: {
          type: 'string',
          description: 'Password for password-protected chats',
        },
        title: {
          type: 'string',
          description: 'Display title for the chat interface',
        },
        versionDescription: {
          type: 'string',
          description:
            'REQUIRED when action is "deploy": a concise (1-3 sentence) description of what changed in this deployment version (distinct from the chat-facing description). If unsure what changed, call diff_workflows(ref1: "live", ref2: "draft") first. Ignored for undeploy.',
        },
        versionName: {
          type: 'string',
          description:
            'REQUIRED when action is "deploy": a short human-readable name/label for this deployment version (distinct from the chat title; shown in deployment history). Ignored for undeploy.',
        },
        welcomeMessage: {
          type: 'string',
          description: 'Welcome message shown to users',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID to deploy (required in workspace context)',
        },
      },
    },
    resultSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action performed by the tool, such as "deploy" or "undeploy".',
        },
        apiEndpoint: {
          type: 'string',
          description: 'Paired workflow execution endpoint used by the chat deployment.',
        },
        baseUrl: {
          type: 'string',
          description: 'Base URL used to construct deployment URLs.',
        },
        chatUrl: {
          type: 'string',
          description: 'Shareable chat URL when the chat surface is deployed.',
        },
        deployedAt: {
          type: 'string',
          description: 'Deployment timestamp for the underlying workflow deployment.',
        },
        deploymentConfig: {
          type: 'object',
          description:
            'Structured deployment configuration keyed by surface name. Includes chat settings and the paired API invocation configuration.',
        },
        deploymentStatus: {
          type: 'object',
          description:
            'Structured per-surface deployment status keyed by surface name, including api and chat.',
        },
        deploymentType: {
          type: 'string',
          description:
            'Deployment surface this result describes. For deploy_as_chat this is always "chat".',
        },
        examples: {
          type: 'object',
          description:
            'Invocation examples keyed by surface name. Includes chat access details and API curl examples.',
        },
        identifier: {
          type: 'string',
          description: 'Chat identifier or slug.',
        },
        isChatDeployed: {
          type: 'boolean',
          description: 'Whether the chat surface is deployed after this tool call.',
        },
        isDeployed: {
          type: 'boolean',
          description: 'Whether the paired API surface remains deployed after this tool call.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the deploy_as_chat action completed successfully.',
        },
        version: {
          type: 'number',
          description: 'Deployment version for the underlying workflow deployment.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID associated with the chat deployment.',
        },
      },
      required: [
        'workflowId',
        'success',
        'action',
        'isDeployed',
        'isChatDeployed',
        'deploymentType',
        'deploymentStatus',
        'deploymentConfig',
        'examples',
      ],
    },
  },
  deploy_as_mcp: {
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            '"deploy" (default) adds/updates the workflow as an MCP tool on the server; "undeploy" removes the workflow\'s tool from the server.',
          enum: ['deploy', 'undeploy'],
        },
        parameterDescriptions: {
          type: 'array',
          description: 'Array of parameter descriptions for the tool',
          items: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description: 'Parameter description',
              },
              name: {
                type: 'string',
                description: 'Parameter name',
              },
            },
            required: ['name', 'description'],
          },
        },
        serverId: {
          type: 'string',
          description: 'Required: server ID from list_workspace_mcp_servers',
        },
        toolDescription: {
          type: 'string',
          description: 'Description for the MCP tool',
        },
        toolName: {
          type: 'string',
          description: 'Name for the MCP tool (defaults to workflow name)',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID (defaults to active workflow)',
        },
      },
      required: ['serverId'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action performed by the tool, such as "deploy" or "undeploy".',
        },
        apiEndpoint: {
          type: 'string',
          description: 'Underlying workflow API endpoint associated with the MCP tool.',
        },
        baseUrl: {
          type: 'string',
          description: 'Base URL used to construct deployment URLs.',
        },
        deploymentConfig: {
          type: 'object',
          description:
            'Structured deployment configuration keyed by surface name. Includes MCP server, tool, auth, and parameter schema details.',
        },
        deploymentStatus: {
          type: 'object',
          description:
            'Structured per-surface deployment status keyed by surface name, including mcp and the underlying api surface when applicable.',
        },
        deploymentType: {
          type: 'string',
          description:
            'Deployment surface this result describes. For deploy_as_mcp this is always "mcp".',
        },
        examples: {
          type: 'object',
          description:
            'Setup examples keyed by surface name. Includes ready-to-paste config snippets for supported MCP clients.',
        },
        mcpServerUrl: {
          type: 'string',
          description: 'HTTP MCP server URL to configure in clients.',
        },
        removed: {
          type: 'boolean',
          description: 'Whether the MCP deployment was removed during an undeploy action.',
        },
        serverId: {
          type: 'string',
          description: 'Workspace MCP server ID.',
        },
        serverName: {
          type: 'string',
          description: 'Workspace MCP server name.',
        },
        toolDescription: {
          type: 'string',
          description: 'MCP tool description exposed on the server.',
        },
        toolId: {
          type: 'string',
          description: 'MCP tool ID when deployed.',
        },
        toolName: {
          type: 'string',
          description: 'MCP tool name exposed on the server.',
        },
        updated: {
          type: 'boolean',
          description: 'Whether an existing MCP tool deployment was updated instead of created.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID associated with the MCP deployment.',
        },
      },
      required: ['deploymentType', 'deploymentStatus'],
    },
  },
  diff_workflows: {
    parameters: {
      type: 'object',
      properties: {
        ref1: {
          type: 'string',
          description:
            'Base side (string): a version number (e.g. "3"), "live" (active deployment), or "draft" (current editor state).',
        },
        ref2: {
          type: 'string',
          description:
            'Target side (string): a version number (e.g. "4"), "live" (active deployment), or "draft" (current editor state).',
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
      required: ['ref1', 'ref2'],
    },
    resultSchema: undefined,
  },
  download_file: {
    parameters: {
      type: 'object',
      properties: {
        fileName: {
          type: 'string',
          description:
            'Backward-compatible workspace file name. Prefer outputs.files[0].path for new calls.',
        },
        outputs: {
          type: 'object',
          description: 'Workspace file output declarations using canonical VFS paths.',
          properties: {
            files: {
              type: 'array',
              description:
                'Files to create or overwrite. Missing parent folders are created automatically for create mode.',
              items: {
                type: 'object',
                properties: {
                  mimeType: {
                    type: 'string',
                    description: 'Optional MIME type override when inference is not enough.',
                  },
                  mode: {
                    type: 'string',
                    description: 'Create a new file or overwrite an existing file at path.',
                    enum: ['create', 'overwrite'],
                  },
                  path: {
                    type: 'string',
                    description: 'Canonical destination VFS path, e.g. "files/Reports/result.csv".',
                  },
                },
                required: ['path', 'mode'],
              },
            },
          },
        },
        url: {
          type: 'string',
          description:
            'Direct URL of the file to download, such as an image CDN URL ending in .png or .jpg',
        },
      },
      required: ['url'],
    },
    resultSchema: undefined,
  },
  edit_workflow: {
    parameters: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: 'Array of edit operations',
          items: {
            type: 'object',
            properties: {
              block_id: {
                type: 'string',
                description:
                  'Block ID for the operation. For add operations, this will be the desired ID for the new block.',
              },
              operation_type: {
                type: 'string',
                description: 'Type of operation to perform',
                enum: ['add', 'edit', 'delete', 'insert_into_subflow', 'extract_from_subflow'],
              },
              params: {
                type: 'object',
                description:
                  'Parameters for the operation (optional).\nFor edit: {"inputs": {"temperature": 0.5}} NOT {"subBlocks": {"temperature": {"value": 0.5}}}\nFor add: {"type": "agent", "name": "My Agent", "inputs": {"model": "<model-id from agent.json>"}}\nFor delete: omit params entirely (none needed)\nBlock-level settings (retry, triggerMode, advancedMode) go beside "inputs", never inside it.',
              },
            },
            required: ['operation_type', 'block_id'],
          },
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID to edit. If not provided, uses the current workflow in context.',
        },
      },
      required: ['operations'],
    },
    resultSchema: undefined,
  },
  extensions: {
    parameters: {
      properties: {
        request: {
          description: 'What tool/skill/MCP action is needed.',
          type: 'string',
        },
        sessionId: {
          description:
            'Reusable session ID returned by an earlier extensions call in this chat. Supply it only on a later user message that continues the same task, and at most once per user message. Omit it for a new or independent task.',
          type: 'string',
        },
        title: {
          description:
            "Required private orchestration label (3–8 words) for this session's stable objective. Stored in the request-local, chat-scoped Subagent Registry supplied only to the main orchestrator; not shown to the extensions agent. When resuming with sessionId, copy the registry title unchanged.",
          maxLength: 120,
          type: 'string',
        },
      },
      required: ['request', 'title'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  extract_doc_assets: {
    parameters: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description:
            'Folder to write the extracted set into. Defaults to a "files/<Source Name> assets" folder next to the source.',
        },
        path: {
          type: 'string',
          description:
            'Workspace VFS path of the source document, e.g. files/Brand%20Deck.pptx. Must be an existing .pptx, .docx, or .pdf file.',
        },
      },
      required: ['path'],
    },
    resultSchema: undefined,
  },
  ffmpeg: {
    parameters: {
      type: 'object',
      properties: {
        aspectRatio: {
          type: 'string',
          description: 'Target aspect ratio for scale_pad, e.g. 9:16, 16:9, 1:1.',
        },
        end: {
          type: 'number',
          description: 'End time in seconds (trim).',
        },
        format: {
          type: 'string',
          description: 'Target format/extension for convert (e.g. mp4, mp3, wav, gif).',
        },
        height: {
          type: 'number',
          description:
            'Target height in pixels (scale_pad). 16-4096, and width x height must not exceed 4096 x 2304.',
          minimum: 16,
          maximum: 4096,
        },
        inputs: {
          type: 'object',
          description:
            'Workspace files this tool reads. Copy paths verbatim from glob/read/grep output — they are percent-encoded per segment (spaces are %20, an in-name slash is %2F; parentheses and dots stay literal). Both the encoded path and the plain name resolve, so copy the returned path exactly rather than retyping or decoding it.',
          properties: {
            files: {
              type: 'array',
              description: 'Workspace files to read, in the order this operation expects them.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Canonical VFS file path, e.g. "files/Reports/clip.mp4".',
                  },
                },
                required: ['path'],
              },
              maxItems: 20,
            },
          },
        },
        loopToVideo: {
          type: 'boolean',
          description: 'For overlay_audio, loop or trim the audio to match the video length.',
        },
        musicVolume: {
          type: 'number',
          description: 'Volume multiplier for the background music track in mix_audio (e.g. 0.3).',
        },
        operation: {
          type: 'string',
          description: 'The FFmpeg operation to run.',
          enum: [
            'overlay_audio',
            'mix_audio',
            'concat',
            'trim',
            'scale_pad',
            'overlay_image',
            'add_text',
            'fade',
            'extract_audio',
            'convert',
            'thumbnail',
            'probe',
          ],
        },
        outputs: {
          type: 'object',
          description: "Workspace files to create or overwrite with this tool's result.",
          properties: {
            files: {
              type: 'array',
              description:
                'File outputs. Missing parent folders are created automatically for create mode.',
              items: {
                type: 'object',
                properties: {
                  mimeType: {
                    type: 'string',
                    description: 'Optional MIME type override when inference is not enough.',
                  },
                  mode: {
                    type: 'string',
                    description: 'Create a new file or overwrite an existing file at path.',
                    enum: ['create', 'overwrite'],
                  },
                  path: {
                    type: 'string',
                    description: 'Canonical destination VFS path, e.g. "files/Reports/clip.mp4".',
                  },
                },
                required: ['path', 'mode'],
              },
            },
          },
        },
        position: {
          type: 'string',
          description: 'Placement for add_text / overlay_image.',
          enum: ['top', 'center', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'],
        },
        start: {
          type: 'number',
          description: 'Start time in seconds (trim, thumbnail, fade).',
        },
        text: {
          type: 'string',
          description: 'Text to burn in for add_text.',
        },
        volume: {
          type: 'number',
          description: 'Volume multiplier for the primary track (mix_audio / overlay_audio).',
        },
        width: {
          type: 'number',
          description:
            'Target width in pixels (scale_pad). 16-4096, and width x height must not exceed 4096 x 2304.',
          minimum: 16,
          maximum: 4096,
        },
      },
      required: ['operation', 'inputs'],
    },
    resultSchema: undefined,
  },
  file: {
    parameters: {
      properties: {
        prompt: {
          description:
            "Optional brief instruction (one short sentence) to scope the task. The agent inherits the full conversation history — do NOT restate or rewrite conversation content, only add scoping the history doesn't convey.",
          type: 'string',
        },
        sessionId: {
          description:
            'Reusable session ID returned by an earlier file call in this chat. Supply it only on a later user message that continues the same task, and at most once per user message — the agent resumes from its saved transcript and receives unseen parent conversation messages. Omit it for a new or independent task.',
          type: 'string',
        },
        title: {
          description:
            "Required private orchestration label (3–8 words) for this session's stable objective. Stored in the request-local, chat-scoped Subagent Registry supplied only to the main orchestrator; not shown to the file agent. When resuming with sessionId, copy the registry title unchanged.",
          maxLength: 120,
          type: 'string',
        },
      },
      required: ['title'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  generate_api_key: {
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            "A descriptive name for the API key (e.g., 'production-key', 'dev-testing').",
        },
        workspaceId: {
          type: 'string',
          description: "Optional workspace ID. Defaults to user's default workspace.",
        },
      },
      required: ['name'],
    },
    resultSchema: undefined,
  },
  generate_audio: {
    parameters: {
      type: 'object',
      properties: {
        duration: {
          type: 'number',
          description:
            'Approximate duration in seconds for sfx (and music models that support it). MiniMax music ignores this — fit music to a video with the ffmpeg tool instead.',
        },
        inputs: {
          type: 'object',
          description:
            'Workspace files this tool reads. Copy paths verbatim from glob/read/grep output — they are percent-encoded per segment (spaces are %20, an in-name slash is %2F; parentheses and dots stay literal). Both the encoded path and the plain name resolve, so copy the returned path exactly rather than retyping or decoding it.',
          properties: {
            files: {
              type: 'array',
              description: 'Workspace files to read, in the order this operation expects them.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Canonical VFS file path, e.g. "files/Reports/clip.mp4".',
                  },
                },
                required: ['path'],
              },
            },
          },
        },
        instrumental: {
          type: 'boolean',
          description:
            'For music: true = instrumental, no vocals (default); false = a song with vocals.',
        },
        lyrics: {
          type: 'string',
          description:
            'For music with vocals: the lyrics to sing (optional; supports [Verse]/[Chorus] tags). Setting this implies instrumental=false.',
        },
        model: {
          type: 'string',
          description:
            'Optional model override for the selected type (e.g. fal-ai/elevenlabs/tts/eleven-v3 for speech).',
        },
        outputs: {
          type: 'object',
          description: "Workspace files to create or overwrite with this tool's result.",
          properties: {
            files: {
              type: 'array',
              description:
                'File outputs. Missing parent folders are created automatically for create mode.',
              items: {
                type: 'object',
                properties: {
                  mimeType: {
                    type: 'string',
                    description: 'Optional MIME type override when inference is not enough.',
                  },
                  mode: {
                    type: 'string',
                    description: 'Create a new file or overwrite an existing file at path.',
                    enum: ['create', 'overwrite'],
                  },
                  path: {
                    type: 'string',
                    description: 'Canonical destination VFS path, e.g. "files/Reports/clip.mp4".',
                  },
                },
                required: ['path', 'mode'],
              },
            },
          },
        },
        prompt: {
          type: 'string',
          description:
            'For speech: the text to speak (may include expressive tags). For music/sfx: a description of the audio to generate.',
        },
        type: {
          type: 'string',
          description: 'Kind of audio to generate. Defaults to speech.',
          enum: ['speech', 'music', 'sfx'],
        },
        voice: {
          type: 'string',
          description: 'Optional voice name or id for speech.',
        },
      },
      required: ['prompt'],
    },
    resultSchema: undefined,
  },
  generate_image: {
    parameters: {
      type: 'object',
      properties: {
        aspectRatio: {
          type: 'string',
          description: 'Aspect ratio for the generated image.',
          enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
        },
        inputs: {
          type: 'object',
          description:
            'Workspace files this tool reads. Copy paths verbatim from glob/read/grep output — they are percent-encoded per segment (spaces are %20, an in-name slash is %2F; parentheses and dots stay literal). Both the encoded path and the plain name resolve, so copy the returned path exactly rather than retyping or decoding it.',
          properties: {
            files: {
              type: 'array',
              description: 'Workspace files to read, in the order this operation expects them.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Canonical VFS file path, e.g. "files/Reports/clip.mp4".',
                  },
                },
                required: ['path'],
              },
            },
          },
        },
        outputs: {
          type: 'object',
          description: "Workspace files to create or overwrite with this tool's result.",
          properties: {
            files: {
              type: 'array',
              description:
                'File outputs. Missing parent folders are created automatically for create mode.',
              items: {
                type: 'object',
                properties: {
                  mimeType: {
                    type: 'string',
                    description: 'Optional MIME type override when inference is not enough.',
                  },
                  mode: {
                    type: 'string',
                    description: 'Create a new file or overwrite an existing file at path.',
                    enum: ['create', 'overwrite'],
                  },
                  path: {
                    type: 'string',
                    description: 'Canonical destination VFS path, e.g. "files/Reports/clip.mp4".',
                  },
                },
                required: ['path', 'mode'],
              },
            },
          },
        },
        prompt: {
          type: 'string',
          description:
            'Detailed text description of the image to generate, or editing instructions when editing the image(s) passed in `inputs.files`.',
        },
      },
      required: ['prompt'],
    },
    resultSchema: undefined,
  },
  generate_video: {
    parameters: {
      type: 'object',
      properties: {
        aspectRatio: {
          type: 'string',
          description: 'Aspect ratio for the video (model-dependent).',
          enum: ['16:9', '9:16', '1:1'],
        },
        duration: {
          type: 'number',
          description: 'Clip duration in seconds (model-dependent; e.g. 4, 6, 8).',
        },
        generateAudio: {
          type: 'boolean',
          description:
            "Toggle Veo's native audio (dialogue/SFX/ambience/music generated from the prompt). Default true. Set false when you will add your own voiceover/music via the ffmpeg tool.",
        },
        inputs: {
          type: 'object',
          description:
            'Workspace files this tool reads. Copy paths verbatim from glob/read/grep output — they are percent-encoded per segment (spaces are %20, an in-name slash is %2F; parentheses and dots stay literal). Both the encoded path and the plain name resolve, so copy the returned path exactly rather than retyping or decoding it.',
          properties: {
            files: {
              type: 'array',
              description: 'Workspace files to read, in the order this operation expects them.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Canonical VFS file path, e.g. "files/Reports/clip.mp4".',
                  },
                },
                required: ['path'],
              },
            },
          },
        },
        model: {
          type: 'string',
          description:
            "Optional model override, keyed to the video's goal: veo-3.1-lite (prototype/quick test, cheapest), veo-3.1-fast (reasonable draft — default, good video), veo-3.1 Standard (final cut / premium quality). Stay on Veo unless the user explicitly asks for another model; seedance-2.0 for >8s narrative, kling-v3-pro for specific looks.",
          enum: [
            'veo-3.1',
            'veo-3.1-fast',
            'veo-3.1-lite',
            'seedance-2.0',
            'seedance-2.0-fast',
            'kling-v3-pro',
            'minimax-hailuo-2.3-pro',
            'wan-2.2-a14b-turbo',
            'ltx-2.3',
          ],
        },
        negativePrompt: {
          type: 'string',
          description:
            'Things to exclude from the video/audio (Veo models), e.g. "no background music" to keep dialogue but drop Veo\'s invented music before overlaying your own track.',
        },
        outputs: {
          type: 'object',
          description: "Workspace files to create or overwrite with this tool's result.",
          properties: {
            files: {
              type: 'array',
              description:
                'File outputs. Missing parent folders are created automatically for create mode.',
              items: {
                type: 'object',
                properties: {
                  mimeType: {
                    type: 'string',
                    description: 'Optional MIME type override when inference is not enough.',
                  },
                  mode: {
                    type: 'string',
                    description: 'Create a new file or overwrite an existing file at path.',
                    enum: ['create', 'overwrite'],
                  },
                  path: {
                    type: 'string',
                    description: 'Canonical destination VFS path, e.g. "files/Reports/clip.mp4".',
                  },
                },
                required: ['path', 'mode'],
              },
            },
          },
        },
        prompt: {
          type: 'string',
          description:
            'Detailed description of the video to generate (scene, action, camera movement, style).',
        },
        promptOptimizer: {
          type: 'boolean',
          description: 'Enable prompt optimization for MiniMax models (default true).',
        },
        resolution: {
          type: 'string',
          description: 'Video resolution (model-dependent), e.g. 720p or 1080p.',
          enum: ['720p', '1080p', '4k'],
        },
      },
      required: ['prompt'],
    },
    resultSchema: undefined,
  },
  get_block_outputs: {
    parameters: {
      type: 'object',
      properties: {
        blockIds: {
          type: 'array',
          description:
            'Optional array of block UUIDs. If provided, returns outputs only for those blocks. If not provided, returns outputs for all blocks in the workflow.',
          items: {
            type: 'string',
          },
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
    },
    resultSchema: undefined,
  },
  get_block_upstream_references: {
    parameters: {
      type: 'object',
      properties: {
        blockIds: {
          type: 'array',
          description:
            'Required array of block UUIDs (minimum 1). Returns what each block can reference based on its position in the workflow graph.',
          items: {
            type: 'string',
          },
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
      required: ['blockIds'],
    },
    resultSchema: undefined,
  },
  get_deployed_workflow_state: {
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
    },
    resultSchema: undefined,
  },
  get_deployment_status: {
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'Workflow ID to check (defaults to current workflow)',
        },
      },
    },
    resultSchema: undefined,
  },
  get_workflow_data: {
    parameters: {
      type: 'object',
      properties: {
        data_type: {
          type: 'string',
          description: 'The type of workflow data to retrieve',
          enum: ['global_variables', 'custom_tools', 'mcp_tools', 'files'],
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
      required: ['data_type'],
    },
    resultSchema: undefined,
  },
  get_workflow_run_options: {
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
    },
    resultSchema: undefined,
  },
  glob: {
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description:
            'Glob pattern to match file paths. Supports * (any segment) and ** (any depth).',
        },
        toolTitle: {
          type: 'string',
          description:
            'Required target-only UI phrase for the search row. The UI verb is supplied for you, so pass text like "workflow configs" or "knowledge bases", not a full sentence like "Finding workflow configs".',
        },
      },
      required: ['pattern', 'toolTitle'],
    },
    resultSchema: undefined,
  },
  grep: {
    parameters: {
      type: 'object',
      properties: {
        context: {
          type: 'number',
          description:
            "Number of lines to show before and after each match (default 0). Only applies to output_mode 'content'.",
        },
        ignoreCase: {
          type: 'boolean',
          description: 'Case insensitive search (default false).',
        },
        lineNumbers: {
          type: 'boolean',
          description:
            "Include line numbers in output (default true). Only applies to output_mode 'content'.",
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of matches to return (default 50).',
        },
        output_mode: {
          type: 'string',
          description:
            "Output mode: 'content' shows matching lines (default), 'files_with_matches' shows only file paths, 'count' shows match counts per file.",
          enum: ['content', 'files_with_matches', 'count'],
        },
        path: {
          type: 'string',
          description:
            "Optional scope. A prefix (e.g. 'workflows/', 'environment/', 'internal/') searches the VFS map under it. An exact supported single-file path searches that file's content; folders and multi-file trees are rejected for content search.",
        },
        pattern: {
          type: 'string',
          description:
            "Regex pattern to search for. Searches VFS map entries (workflow JSON, metadata, memories) by default, or an exact supported file leaf's content when path selects one.",
        },
        toolTitle: {
          type: 'string',
          description:
            'Required target-only UI phrase for the search row. The UI verb is supplied for you, so pass text like "Slack integrations" or "deployed workflows", not a full sentence like "Searching for Slack integrations".',
        },
      },
      required: ['pattern', 'toolTitle'],
    },
    resultSchema: undefined,
  },
  interrupt_agent: {
    parameters: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'The agent id to interrupt.',
        },
        reason: {
          type: 'string',
          description:
            "Why you are stopping it, in a few words. Recorded in the agent's final status.",
        },
      },
      required: ['agent_id'],
    },
    resultSchema: undefined,
  },
  knowledge: {
    parameters: {
      properties: {
        request: {
          description: 'What knowledge base action is needed.',
          type: 'string',
        },
        sessionId: {
          description:
            'Reusable session ID returned by an earlier knowledge call in this chat. Supply it only on a later user message that continues the same task, and at most once per user message. Omit it for a new or independent task.',
          type: 'string',
        },
        title: {
          description:
            "Required private orchestration label (3–8 words) for this session's stable objective. Stored in the request-local, chat-scoped Subagent Registry supplied only to the main orchestrator; not shown to the knowledge agent. When resuming with sessionId, copy the registry title unchanged.",
          maxLength: 120,
          type: 'string',
        },
      },
      required: ['request', 'title'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  list_deployment_versions: {
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
    },
    resultSchema: undefined,
  },
  list_integration_tools: {
    parameters: {
      properties: {
        integration: {
          description:
            'The integration service name — the folder under components/integrations/ (e.g. "slack", "gmail", "google_sheets"). Returns every operation\'s id, name, and description for that service.',
          type: 'string',
        },
      },
      required: ['integration'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  list_workspace_mcp_servers: {
    parameters: {
      type: 'object',
      properties: {
        workspaceId: {
          type: 'string',
          description:
            'Workspace ID. Required when no current workspace context is available, such as headless MCP calls.',
        },
      },
    },
    resultSchema: undefined,
  },
  load_deployment: {
    parameters: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          description:
            'A string: a deployment version number (e.g. "5"), or "live" for the active deployment. (Unlike promote_to_live, which takes a numeric version, "live" is accepted here.)',
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
      required: ['version'],
    },
    resultSchema: undefined,
  },
  load_integration_tool: {
    parameters: {
      properties: {
        tool_ids: {
          description:
            'Exact integration tool ids to load before calling them, e.g. ["gmail_send_v2"]. Copy the "id" field verbatim from components/integrations/{service}/{operation}.json (including any version suffix).',
          items: {
            type: 'string',
          },
          type: 'array',
        },
      },
      required: ['tool_ids'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  load_skill: {
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            "Skill name exactly as it appears in the Loadable Skills index (e.g. 'pptx-writing').",
        },
      },
      required: ['name'],
    },
    resultSchema: undefined,
  },
  load_slide_layout: {
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            "Layout name exactly as it appears in the Layout Library index (e.g. 'metric-cards').",
        },
      },
      required: ['name'],
    },
    resultSchema: undefined,
  },
  manage_credential: {
    parameters: {
      type: 'object',
      properties: {
        credentialId: {
          type: 'string',
          description: 'The credential ID (required for rename)',
        },
        credentialIds: {
          type: 'array',
          description: 'Array of credential IDs (for batch delete)',
          items: {
            type: 'string',
          },
        },
        displayName: {
          type: 'string',
          description: 'New display name (required for rename)',
        },
        operation: {
          type: 'string',
          description: 'The operation to perform',
          enum: ['rename', 'delete'],
        },
      },
      required: ['operation'],
    },
    resultSchema: undefined,
  },
  manage_custom_tool: {
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'The JavaScript code that executes when the tool is called (required for add). Parameters from schema are available as variables. Function body only - no signature or wrapping braces.',
        },
        operation: {
          type: 'string',
          description:
            "The operation to perform: 'add', 'edit', 'list', or 'delete'. These verbs are tool-specific — other manage_* tools may use create/update instead of add/edit.",
          enum: ['add', 'edit', 'delete', 'list'],
        },
        schema: {
          type: 'object',
          description: 'The tool schema in OpenAI function calling format (required for add).',
          properties: {
            function: {
              type: 'object',
              description: 'The function definition',
              properties: {
                description: {
                  type: 'string',
                  description: 'What the function does',
                },
                name: {
                  type: 'string',
                  description: 'The function name (camelCase)',
                },
                parameters: {
                  type: 'object',
                  description: 'The function parameters schema',
                  properties: {
                    properties: {
                      type: 'object',
                      description: 'Parameter definitions as key-value pairs',
                    },
                    required: {
                      type: 'array',
                      description: 'Array of required parameter names',
                      items: {
                        type: 'string',
                      },
                    },
                    type: {
                      type: 'string',
                      description: "Must be 'object'",
                    },
                  },
                  required: ['type', 'properties'],
                },
              },
              required: ['name', 'parameters'],
            },
            type: {
              type: 'string',
              description: "Must be 'function'",
            },
          },
          required: ['type', 'function'],
        },
        toolId: {
          type: 'string',
          description:
            "The ID of the custom tool. Get it from the `list` operation or the `id` field inside the tool's VFS file (agent/custom-tools/{name}.json — the filename is the display name, not the id); get_workflow_data also returns it where that tool is available. Do not guess or construct it. Required for edit and delete; omit for add and list.",
        },
        toolIds: {
          type: 'array',
          description: 'Array of custom tool IDs (for batch delete)',
          items: {
            type: 'string',
          },
        },
      },
      required: ['operation'],
    },
    resultSchema: undefined,
  },
  manage_knowledge_base: {
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'object',
          description: 'Arguments for the operation',
          properties: {
            apiKey: {
              type: 'string',
              description:
                'API key for API-key-based connectors (required when connector auth mode is apiKey). Accepts an environment-variable reference — {{NAME}} — resolved server-side from workspace/user environment variables; a raw key also works.',
            },
            chunkingConfig: {
              type: 'object',
              description: "Chunking configuration (optional for 'create')",
              properties: {
                maxSize: {
                  type: 'number',
                  description: 'Maximum chunk size (100-4000, default: 1024)',
                  default: 1024,
                },
                minSize: {
                  type: 'number',
                  description: 'Minimum chunk size (1-2000, default: 100)',
                  default: 1,
                },
                overlap: {
                  type: 'number',
                  description: 'Overlap between chunks (0-500, default: 200)',
                  default: 200,
                },
              },
            },
            connectorId: {
              type: 'string',
              description:
                'Connector ID (required for update_connector, delete_connector, sync_connector)',
            },
            connectorStatus: {
              type: 'string',
              description: 'Connector status (optional for update_connector)',
              enum: ['active', 'paused'],
            },
            connectorType: {
              type: 'string',
              description:
                "Connector type from registry, e.g. 'confluence', 'google_drive', 'notion' (required for add_connector). Read knowledgebases/connectors/{type}.json for the config schema.",
            },
            credentialId: {
              type: 'string',
              description:
                'OAuth credential ID from environment/credentials.json (required for OAuth connectors)',
            },
            description: {
              type: 'string',
              description: "Description of the knowledge base (optional for 'create')",
            },
            disabledTagIds: {
              type: 'array',
              description:
                'Tag definition IDs to opt out of (optional for add_connector). See tagDefinitions in the connector schema.',
              items: {
                type: 'string',
              },
            },
            documentId: {
              type: 'string',
              description: 'Document ID (required for update_document)',
            },
            documentIds: {
              type: 'array',
              description: 'Document IDs (for batch delete_document)',
              items: {
                type: 'string',
              },
            },
            enabled: {
              type: 'boolean',
              description: 'Enable/disable a document (optional for update_document)',
            },
            filePaths: {
              type: 'array',
              description:
                'Canonical workspace file VFS paths to add as documents (for add_file), e.g. ["files/Docs/handbook.pdf"].',
              items: {
                type: 'string',
              },
            },
            filename: {
              type: 'string',
              description: 'New filename for a document (optional for update_document)',
            },
            knowledgeBaseId: {
              type: 'string',
              description:
                'Knowledge base ID (required for get, query, add_file, list_tags, create_tag, get_tag_usage)',
            },
            knowledgeBaseIds: {
              type: 'array',
              description: 'Knowledge base IDs (for batch delete)',
              items: {
                type: 'string',
              },
            },
            name: {
              type: 'string',
              description: "Name of the knowledge base (required for 'create')",
            },
            query: {
              type: 'string',
              description: "Search query text (required for 'query')",
            },
            sourceConfig: {
              type: 'object',
              description:
                'Connector-specific configuration matching the configFields in knowledgebases/connectors/{type}.json',
            },
            syncIntervalMinutes: {
              type: 'number',
              description:
                'Sync interval in minutes. Accepted values: 60 (hourly), 360 (6h), 1440 (daily), 10080 (weekly), 0 (manual only). Default: 1440',
              default: 1440,
            },
            tagDefinitionId: {
              type: 'string',
              description: 'Tag definition ID (required for update_tag, delete_tag)',
            },
            tagDisplayName: {
              type: 'string',
              description:
                'Display name for the tag (required for create_tag, optional for update_tag)',
            },
            tagFieldType: {
              type: 'string',
              description:
                'Field type: text, number, date, boolean (optional for create_tag, defaults to text)',
              enum: ['text', 'number', 'date', 'boolean'],
            },
            tagValues: {
              type: 'array',
              description:
                'Typed tag values to set on this document (optional for update_document). Resolve tagDefinitionId with list_tags first. Use null to clear a value.',
              items: {
                type: 'object',
                properties: {
                  tagDefinitionId: {
                    type: 'string',
                    description: 'Tag definition ID returned by list_tags.',
                  },
                  value: {
                    type: ['string', 'number', 'boolean', 'null'],
                    description:
                      "Value matching the tag definition's field type: string for text, number for number, YYYY-MM-DD string for date, boolean for boolean, or null to clear.",
                  },
                },
                required: ['tagDefinitionId', 'value'],
              },
            },
            topK: {
              type: 'number',
              description: 'Number of results to return (1-100, default: 5)',
              default: 5,
            },
            workspaceId: {
              type: 'string',
              description:
                "Workspace ID. Required for 'create' when there is no workspace in context; otherwise the current workspace context is used.",
            },
          },
        },
        operation: {
          type: 'string',
          description: 'The operation to perform',
          enum: [
            'create',
            'get',
            'query',
            'add_file',
            'update',
            'delete_document',
            'update_document',
            'list_tags',
            'create_tag',
            'update_tag',
            'delete_tag',
            'get_tag_usage',
            'add_connector',
            'update_connector',
            'delete_connector',
            'sync_connector',
          ],
        },
      },
      required: ['operation'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: ['object', 'array'],
          description:
            'Operation-specific result payload. An object for most operations; list_tags and get_tag_usage return an array of tag definitions.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome summary.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the operation succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  manage_mcp_connection: {
    parameters: {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          description: 'Required for add and edit. The MCP server configuration.',
          properties: {
            enabled: {
              type: 'boolean',
              description: 'Whether the server is enabled (default: true)',
            },
            headers: {
              type: 'object',
              description:
                'Optional HTTP headers to send with requests (key-value pairs). Values accept {{ENV_VAR}} references, resolved per-user at connect time — prefer them over pasting raw tokens.',
            },
            name: {
              type: 'string',
              description: 'Display name for the MCP server',
            },
            timeout: {
              type: 'number',
              description: 'Request timeout in milliseconds (default: 30000)',
            },
            transport: {
              type: 'string',
              description: "Transport protocol: 'streamable-http' or 'sse'",
              enum: ['streamable-http', 'sse'],
              default: 'streamable-http',
            },
            url: {
              type: 'string',
              description: 'The MCP server endpoint URL (required for add)',
            },
          },
        },
        operation: {
          type: 'string',
          description:
            "The operation to perform: 'add', 'edit', 'list', or 'delete'. These verbs are tool-specific — other manage_* tools may use create/update instead of add/edit.",
          enum: ['add', 'edit', 'delete', 'list'],
        },
        serverId: {
          type: 'string',
          description:
            "The MCP server's id — the `id` field inside the VFS file agent/mcp-servers/{name}.json (the {name} filename is the display name, not the id). Required for edit and delete; omit for add and list.",
        },
      },
      required: ['operation'],
    },
    resultSchema: undefined,
  },
  manage_sandbox: {
    parameters: {
      type: 'object',
      properties: {
        cliTools: {
          type: 'array',
          description:
            'Complete managed CLI id list (maximum 10). Use exact pinned ids returned by list. On edit, passing this replaces the whole list; pass [] to clear it.',
          items: {
            type: 'string',
          },
        },
        dependencies: {
          type: 'array',
          description:
            'Complete npm or PyPI dependency list (maximum 50). On edit, passing this replaces the whole list; pass [] to clear it.',
          items: {
            type: 'string',
          },
        },
        language: {
          type: 'string',
          description:
            'Dependency language. javascript installs from npm; python installs from PyPI. Required for add; optional for edit.',
          enum: ['javascript', 'python'],
        },
        name: {
          type: 'string',
          description:
            'Workspace-unique Sim sandbox name (1-64 characters). Required for add; optional for edit.',
        },
        operation: {
          type: 'string',
          description: "The operation to perform: 'add', 'edit', 'list', or 'delete'.",
          enum: ['add', 'edit', 'delete', 'list'],
        },
        sandboxId: {
          type: 'string',
          description:
            'The Sim sandbox id. Get it from list or the inner id field in agent/sandboxes/{name}.json; never guess it. Required for edit and delete.',
        },
        systemPackages: {
          type: 'array',
          description:
            'Complete Debian package-coordinate list in package[:architecture][=version] form (maximum 50). On edit, passing this replaces the whole list; pass [] to clear it.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['operation'],
    },
    resultSchema: undefined,
  },
  manage_skill: {
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Markdown instructions for the skill. Required for add, optional for edit.',
        },
        description: {
          type: 'string',
          description: 'Short description of the skill. Required for add, optional for edit.',
        },
        name: {
          type: 'string',
          description:
            "Skill name in kebab-case (e.g. 'my-skill'). Required for add, optional for edit.",
        },
        operation: {
          type: 'string',
          description:
            "The operation to perform: 'add', 'edit', 'list', or 'delete'. These verbs are tool-specific — other manage_* tools may use create/update instead of add/edit.",
          enum: ['add', 'edit', 'delete', 'list'],
        },
        skillId: {
          type: 'string',
          description:
            "The skill's id — the `id` field inside the VFS file agent/skills/{name}.json (the {name} filename is the display name, not the id). Required for edit and delete; omit for add and list.",
        },
      },
      required: ['operation'],
    },
    resultSchema: undefined,
  },
  media: {
    parameters: {
      properties: {
        prompt: {
          description:
            "Optional brief instruction (one short sentence) to scope the task. The agent inherits the full conversation history — do NOT restate or rewrite conversation content, only add scoping the history doesn't convey.",
          type: 'string',
        },
      },
      type: 'object',
    },
    resultSchema: undefined,
  },
  mkdir: {
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          description:
            'Canonical folder VFS paths to create, e.g. ["files/Reports/2026"]. Missing parent segments are created automatically.',
          items: {
            type: 'string',
          },
        },
        toolTitle: {
          type: 'string',
          description:
            'Target-only UI phrase for the action row, e.g. "Reports/2026" or "2 folders", not a full sentence like "Creating Reports".',
        },
      },
      required: ['paths', 'toolTitle'],
    },
    resultSchema: undefined,
  },
  mv: {
    parameters: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description:
            'Target path. A path ending in "/" (or naming an existing folder) moves sources into it keeping their names — always use the trailing "/" form when targeting a folder. Otherwise the last segment is the new name and the preceding segments are the target folder (created automatically when missing).',
        },
        sources: {
          type: 'array',
          description:
            'Canonical VFS paths to move or rename, e.g. ["files/draft.md"]. All sources must share one category. Copy paths verbatim from glob/grep/read output.',
          items: {
            type: 'string',
          },
        },
        toolTitle: {
          type: 'string',
          description:
            'Target-only UI phrase for the action row, e.g. "draft.md to Reports" or "3 files to Images", not a full sentence like "Moving draft.md".',
        },
      },
      required: ['sources', 'destination', 'toolTitle'],
    },
    resultSchema: undefined,
  },
  oauth_get_auth_link: {
    parameters: {
      type: 'object',
      properties: {
        credentialId: {
          type: 'string',
          description:
            'Optional. The id of an EXISTING credential (from environment/credentials.json) to reconnect/re-authorize in place. Only when the user explicitly asks to reconnect or repair that credential — never for adding another account.',
        },
        providerName: {
          type: 'string',
          description:
            "The OAuth provider to connect. Pass the integration's provider value (e.g. `google-email`, `slack`); the service display name or providerId resolves case-insensitively/fuzzily, so avoid bare base providers like `google`.",
        },
      },
      required: ['providerName'],
    },
    resultSchema: undefined,
  },
  oauth_request_access: {
    parameters: {
      type: 'object',
      properties: {
        providerName: {
          type: 'string',
          description:
            "The OAuth provider to connect. Pass the integration's provider value (e.g. `google-email`, `slack`).",
        },
      },
      required: ['providerName'],
    },
    resultSchema: undefined,
  },
  open_resource: {
    parameters: {
      type: 'object',
      properties: {
        resources: {
          type: 'array',
          description:
            'Array of resources to open. Each item must have type and either id or, for files, path.',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Canonical resource ID for non-file resources.',
              },
              path: {
                type: 'string',
                description:
                  'Encoded VFS path for type "file" (percent-encoded per segment, e.g. "files/Reports/Q4%20Report.pdf"). Copy it verbatim from glob/read/workspace context output — do not decode it to a display name or re-encode it.',
              },
              type: {
                type: 'string',
                description: 'The resource type.',
                enum: ['workflow', 'table', 'knowledgebase', 'file', 'log'],
              },
              view: {
                type: 'string',
                description:
                  'Saved table view to open pinned (type "table" only): a view ID from the table\'s views.json. The panel opens the table with that view\'s filter/sort active. Omit to open the table on its default view.',
              },
            },
            required: ['type'],
          },
        },
      },
      required: ['resources'],
    },
    resultSchema: undefined,
  },
  platform: {
    parameters: {
      properties: {
        task: {
          description:
            "A fully self-contained question about Sim — the platform agent sees none of this conversation, so include every name, id, constraint, and prior finding it needs. Example: 'what is the minimum schedule-trigger interval, and does it differ by plan?' or 'does the agent block persist memory across runs?'.",
          type: 'string',
        },
      },
      required: ['task'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  prepare_file_edit: {
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: 'The file operation to perform.',
          enum: ['append', 'update', 'patch'],
        },
        target: {
          type: 'object',
          description: 'Explicit file target. Use kind=path + path for existing files.',
          properties: {
            kind: {
              type: 'string',
              description: 'How the file target is identified.',
              enum: ['path'],
            },
            path: {
              type: 'string',
              description:
                'Canonical existing workspace file VFS path, e.g. "files/Reports/report.md". Required when target.kind=path.',
            },
          },
          required: ['kind'],
        },
        title: {
          type: 'string',
          description:
            'Required short UI label for this content unit, e.g. "Chapter 1", "Slide 3", or "Fix footer spacing".',
        },
        contentType: {
          type: 'string',
          description:
            'Optional MIME type override. Usually omit and let the system infer from the target file extension.',
          enum: [
            'text/markdown',
            'text/html',
            'text/plain',
            'application/json',
            'text/csv',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/pdf',
          ],
        },
        edit: {
          type: 'object',
          description:
            'Patch metadata. Use strategy=search_replace for exact text replacement, or strategy=anchored for line-based inserts/replacements/deletions. The actual replacement/insert content is provided via the paired apply_file_edit tool call.',
          properties: {
            after_anchor: {
              type: 'string',
              description:
                'Boundary line kept after inserted replacement content. Required for mode=replace_between.',
            },
            anchor: {
              type: 'string',
              description:
                'Anchor line after which new content is inserted. Required for mode=insert_after.',
            },
            before_anchor: {
              type: 'string',
              description:
                'Boundary line kept before inserted replacement content. Required for mode=replace_between.',
            },
            end_anchor: {
              type: 'string',
              description: 'First line to keep after deletion. Required for mode=delete_between.',
            },
            mode: {
              type: 'string',
              description: 'Anchored edit mode when strategy=anchored.',
              enum: ['replace_between', 'insert_after', 'delete_between'],
            },
            occurrence: {
              type: 'number',
              description: '1-based occurrence for repeated anchor lines. Optional; defaults to 1.',
            },
            replaceAll: {
              type: 'boolean',
              description:
                'When true and strategy=search_replace, replace every match instead of requiring a unique single match.',
            },
            search: {
              type: 'string',
              description:
                'Exact text to find when strategy=search_replace. Must match exactly once unless replaceAll=true.',
            },
            start_anchor: {
              type: 'string',
              description: 'First line to delete. Required for mode=delete_between.',
            },
            strategy: {
              type: 'string',
              description: 'Patch strategy.',
              enum: ['search_replace', 'anchored'],
            },
          },
        },
      },
      required: ['operation', 'target', 'title'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description:
            'Optional operation metadata such as file id, file name, size, and content type.',
        },
        message: {
          type: 'string',
          description: 'Human-readable summary of the outcome.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the file operation succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  promote_to_live: {
    parameters: {
      type: 'object',
      properties: {
        version: {
          type: 'number',
          description:
            'The numeric deployment version number to promote to live (e.g. 5). "live" is not accepted here — pass the version number (use load_deployment to change the draft).',
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
      required: ['version'],
    },
    resultSchema: undefined,
  },
  publish_custom_block: {
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Whether to publish (deploy) or unpublish (undeploy) the custom block',
          enum: ['deploy', 'undeploy'],
          default: 'deploy',
        },
        description: {
          type: 'string',
          description: 'Short description shown in the block picker, max 280 characters',
        },
        exposedOutputs: {
          type: 'array',
          description:
            "Outputs the block exposes, each mapping a child block output path to a friendly name (use get_block_outputs for valid paths). Omit to expose the terminal block's whole result",
          items: {
            type: 'object',
            properties: {
              blockId: {
                type: 'string',
                description: 'Block UUID inside the workflow',
              },
              name: {
                type: 'string',
                description: 'Friendly output name shown on the block',
              },
              path: {
                type: 'string',
                description:
                  "Dot-path into that block's output (from get_block_outputs relativeOutputs)",
              },
            },
            required: ['blockId', 'path', 'name'],
          },
        },
        iconUrl: {
          type: 'string',
          description:
            'Optional icon image for the block: a workspace file VFS path (e.g. "files/icon.png", copied into public icon storage at publish) or an https image URL. Omit to use the organization\'s default icon',
        },
        inputs: {
          type: 'array',
          description:
            "Optional per-input placeholder overrides. Input names and types are derived from the workflow's input trigger and cannot be changed here",
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Stable id of the input trigger field',
              },
              placeholder: {
                type: 'string',
                description: "Placeholder text shown in the block's input field",
              },
            },
            required: ['id'],
          },
        },
        name: {
          type: 'string',
          description:
            'Display name for the block, max 60 characters. REQUIRED the first time a workflow is published. When republishing an existing block, omit it to keep the current name or pass a new one to rename. Ignored for undeploy.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID (defaults to active workflow)',
        },
      },
    },
    resultSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action performed by the tool, such as "deploy" or "undeploy".',
        },
        blockId: {
          type: 'string',
          description: 'Custom block record ID.',
        },
        blockType: {
          type: 'string',
          description: 'Stable block type slug (custom_block_*) used in workflow state.',
        },
        deploymentConfig: {
          type: 'object',
          description:
            "Structured deployment configuration keyed by surface name. Includes the block's type, name, description, icon, derived input fields, and exposed outputs.",
        },
        deploymentStatus: {
          type: 'object',
          description:
            'Structured per-surface deployment status keyed by surface name, including customBlock and the underlying api surface when applicable.',
        },
        deploymentType: {
          type: 'string',
          description:
            'Deployment surface this result describes. For publish_custom_block this is always "custom_block".',
        },
        isDeployed: {
          type: 'boolean',
          description: 'Whether the custom block is published after this tool call.',
        },
        name: {
          type: 'string',
          description: 'Display name of the custom block.',
        },
        removed: {
          type: 'boolean',
          description: 'Whether the custom block was unpublished during an undeploy action.',
        },
        updated: {
          type: 'boolean',
          description: 'Whether an existing custom block was updated instead of created.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID the custom block is bound to.',
        },
      },
      required: ['deploymentType', 'deploymentStatus'],
    },
  },
  query_logs: {
    parameters: {
      type: 'object',
      properties: {
        blockId: {
          type: 'string',
          description: "Optional (view='full'): only return this block's span subtree.",
        },
        blockIds: {
          type: 'array',
          description:
            "(view='full') Block ids to drill into, copied from the trace digest's blockId values. Preferred over blockName; several at once is fine.",
          items: {
            type: 'string',
          },
        },
        blockName: {
          type: 'string',
          description: "Optional (view='full'): only return spans for this block name.",
        },
        bucket: {
          type: 'string',
          description:
            "(view='stats') Calendar bucketing for the per-workflow series: 'day' or 'hour'. Omit for overall totals only.",
          enum: ['day', 'hour'],
        },
        costOperator: {
          type: 'string',
          description: "Filter (view='list'): comparison operator for cost.",
          enum: ['=', '>', '<', '>=', '<=', '!='],
        },
        costValue: {
          type: 'number',
          description: "Filter (view='list'): cost threshold paired with costOperator.",
        },
        cursor: {
          type: 'string',
          description: "Pagination cursor (view='list') from a prior response's nextCursor.",
        },
        durationOperator: {
          type: 'string',
          description: "Filter (view='list'): comparison operator for duration (ms).",
          enum: ['=', '>', '<', '>=', '<=', '!='],
        },
        durationValue: {
          type: 'number',
          description:
            "Filter (view='list'): duration threshold (ms) paired with durationOperator.",
        },
        endDate: {
          type: 'string',
          description: "Filter (view='list'/'stats'): ISO end of the time range.",
        },
        executionId: {
          type: 'string',
          description:
            "Required for 'trace'/'overview'/'full': the execution to read. For 'list', an optional exact-match filter.",
        },
        fields: {
          type: 'array',
          description:
            "(view='full') Only load these payload fields per span: whole keys ('input', 'output', 'error') or dotted paths into them ('output.result.rows', 'input.query'). Dotted selections come back under 'selected' keyed by path. Use this to pull just the field you need instead of a block's entire I/O.",
          items: {
            type: 'string',
          },
        },
        folderIds: {
          type: 'string',
          description:
            "Filter (view='list'/'stats'): comma-separated folder IDs (descendants included).",
        },
        folderName: {
          type: 'string',
          description: "Filter (view='list'/'stats'): substring match on folder name.",
        },
        level: {
          type: 'string',
          description:
            "Filter (view='list'/'stats'): comma-separated levels: error, info, running, pending. Default all.",
        },
        limit: {
          type: 'number',
          description: "Max results (view='list'), 1-200 (default 100).",
        },
        pattern: {
          type: 'string',
          description:
            "Optional separate parameter (not a 'view' value): with view 'overview' or 'full', greps the execution's trace spans (requires executionId), returning matching spans with snippets instead of the full log.",
        },
        search: {
          type: 'string',
          description: "Filter (view='list'): substring match on executionId.",
        },
        sortBy: {
          type: 'string',
          description: "Sort field (view='list').",
          enum: ['date', 'duration', 'cost', 'status'],
        },
        sortOrder: {
          type: 'string',
          description: "Sort order (view='list').",
          enum: ['asc', 'desc'],
        },
        startDate: {
          type: 'string',
          description: "Filter (view='list'/'stats'): ISO start of the time range.",
        },
        timezone: {
          type: 'string',
          description:
            '(view=\'stats\') IANA timezone the buckets are computed in, e.g. "America/Los_Angeles". Defaults to UTC. Set this whenever the user\'s question is about "today"/"yesterday" in their local time.',
        },
        title: {
          type: 'string',
          description:
            'Short human-readable label for this query, shown as the tool row in the UI, e.g. "Counting Elder failures Aug 12-13" or "Reading the failed enrichment run". Always provide one — it is how the user follows what you are looking for.',
        },
        triggers: {
          type: 'string',
          description: "Filter (view='list'/'stats'): comma-separated trigger types.",
        },
        view: {
          type: 'string',
          description:
            "Disclosure level: 'stats' (aggregate counts), 'list' (summaries), 'trace' (one execution's condensed block digest), 'overview' (trace tree, no I/O), 'full' (spans with I/O). Defaults to 'trace' with executionId, else 'list'.",
          enum: ['list', 'stats', 'trace', 'overview', 'full'],
        },
        workflowIds: {
          type: 'string',
          description: "Filter (view='list'/'stats'): comma-separated workflow IDs.",
        },
        workflowName: {
          type: 'string',
          description: "Filter (view='list'/'stats'): substring match on workflow name.",
        },
        workspaceId: {
          type: 'string',
          description: 'Workspace ID to scope to.',
        },
      },
    },
    resultSchema: undefined,
  },
  query_user_table: {
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'object',
          description: 'Arguments for the operation',
          properties: {
            cursor: {
              type: 'string',
              description:
                'Opaque pagination cursor for query_rows (optional). Omit for the first page; to fetch the next page, pass back the nextCursor from the previous result\'s "more available" message verbatim. Cannot be combined with a fresh order — the cursor already encodes the paging position.',
            },
            filter: {
              type: 'object',
              description:
                'Predicate filter object for query_rows. A predicate is a tree: {"all":[...]} (AND) or {"any":[...]} (OR); members are leaves {field, op, value} or nested groups. Ops: eq, ne, gt, gte, lt, lte, in, nin, like, ilike (use * as the wildcard), nlike, nilike, contains, ncontains, startsWith, endsWith, isNull, isNotNull, isEmpty, isNotEmpty. in/nin take a non-empty array value. TTL filter values are absolute whole Unix epoch seconds, never milliseconds. Examples: {"all":[{"field":"status","op":"eq","value":"active"}]}; {"any":[{"field":"status","op":"eq","value":"active"},{"field":"status","op":"eq","value":"pending"}]}; {"all":[{"field":"name","op":"ilike","value":"*jo*"}]}.',
            },
            limit: {
              type: 'number',
              description:
                'Maximum rows per page for query_rows (optional, max 1000). Omitting it uses the 1000-row default page — the ENTIRE result is never returned in one call; a non-null nextCursor in the result means more rows exist (continue with cursor). A page may also end early at the byte budget with more remaining.',
            },
            order: {
              type: 'array',
              description:
                'Sort spec for query_rows (optional). Ordered list of {field, direction} where direction is asc or desc, e.g. [{"field":"wins","direction":"desc"},{"field":"name","direction":"asc"}].',
              items: {
                type: 'object',
                properties: {
                  direction: {
                    type: 'string',
                    enum: ['asc', 'desc'],
                  },
                  field: {
                    type: 'string',
                  },
                },
                required: ['field', 'direction'],
              },
            },
            rowId: {
              type: 'string',
              description: 'Row ID (required for get_row)',
            },
            tableId: {
              type: 'string',
              description: 'Table ID (required for all operations)',
            },
            view: {
              type: 'string',
              description:
                "Saved view to query through (query_rows only): a view ID from the table's views.json. The view's saved filter ANDs with any filter you pass (query-within-the-view); its saved sort applies only when you pass no order. Layout fields (hidden columns, widths) are ignored — full rows come back. Manage views via the table agent.",
            },
          },
        },
        operation: {
          type: 'string',
          description: 'The read operation to perform',
          enum: ['get', 'get_schema', 'get_row', 'query_rows'],
        },
      },
      required: ['operation', 'args'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Operation-specific result payload.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome summary.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the operation succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  read: {
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read.',
        },
        offset: {
          type: 'number',
          description: 'Line offset to start reading from (0-indexed).',
        },
        outputTable: {
          type: 'string',
          description:
            'Table ID to import the file contents into (CSV/JSON). All existing rows are replaced. Example: "tbl_abc123"',
        },
        path: {
          type: 'string',
          description:
            "Path to the VFS resource to read (e.g. 'workflows/My%20Workflow/state.json', 'files/Q4%20Report.pdf/content' for file bytes/parsed text, or 'uploads/data.csv' for a chat upload). Copy paths verbatim from glob/grep/read output.",
        },
      },
      required: ['path'],
    },
    resultSchema: undefined,
  },
  read_document: {
    parameters: {
      properties: {
        documentId: {
          description: 'Canonical document ID returned by search or the selected document context.',
          type: 'string',
        },
        limit: {
          default: 20,
          description: 'Maximum number of chunks to read.',
          maximum: 50,
          minimum: 1,
          type: 'integer',
        },
        offset: {
          default: 0,
          description: 'Number of chunks to skip.',
          maximum: 5000,
          minimum: 0,
          type: 'integer',
        },
      },
      required: ['documentId'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  redeploy: {
    parameters: {
      type: 'object',
      properties: {
        versionDescription: {
          type: 'string',
          description:
            'REQUIRED: a concise (1-3 sentence) description of what changed in this deployment version. If unsure what changed, call diff_workflows(ref1: "live", ref2: "draft") first.',
        },
        versionName: {
          type: 'string',
          description:
            'REQUIRED: a short human-readable name/label for this deployment version, shown in deployment history.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID to redeploy (required in workspace context)',
        },
      },
      required: ['versionDescription', 'versionName'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        apiEndpoint: {
          type: 'string',
          description: 'Canonical workflow execution endpoint.',
        },
        baseUrl: {
          type: 'string',
          description: 'Base URL used to construct deployment URLs.',
        },
        deployedAt: {
          type: 'string',
          description: 'Deployment timestamp when the workflow is deployed.',
        },
        deploymentConfig: {
          type: 'object',
          description:
            'Structured deployment configuration keyed by surface name. For API deploys this includes endpoint, auth, and sync/stream/async mode details.',
        },
        deploymentStatus: {
          type: 'object',
          description:
            'Structured per-surface deployment status keyed by surface name, such as api.',
        },
        deploymentType: {
          type: 'string',
          description:
            'Deployment surface this result describes. For deploy_as_api and redeploy this is always "api".',
        },
        examples: {
          type: 'object',
          description:
            'Invocation examples keyed by surface name. For API deploys this includes curl examples for sync, stream, async, and polling.',
        },
        isDeployed: {
          type: 'boolean',
          description: 'Whether the workflow API is currently deployed after this tool call.',
        },
        version: {
          type: 'number',
          description: 'Deployment version for the current API deployment.',
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID that was deployed or undeployed.',
        },
      },
      required: [
        'workflowId',
        'isDeployed',
        'deploymentType',
        'deploymentStatus',
        'deploymentConfig',
        'examples',
      ],
    },
  },
  respond: {
    parameters: {
      additionalProperties: true,
      properties: {
        output: {
          description:
            'The result — facts, status, VFS paths to persisted data, whatever the caller needs to act on.',
          type: 'string',
        },
        paths: {
          description:
            'Affected VFS file paths. Required when the File Agent reports a successful file mutation.',
          items: {
            type: 'string',
          },
          type: 'array',
        },
        success: {
          description: 'Whether the task completed successfully',
          type: 'boolean',
        },
        type: {
          description: 'Optional logical result type override',
          type: 'string',
        },
      },
      required: ['output', 'success'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  restore_resource: {
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The canonical resource ID to restore.',
        },
        type: {
          type: 'string',
          description: 'The resource type to restore.',
          enum: [
            'workflow',
            'table',
            'file',
            'knowledgebase',
            'folder',
            'file_folder',
            'table_folder',
            'knowledge_folder',
          ],
        },
      },
      required: ['type', 'id'],
    },
    resultSchema: undefined,
  },
  rm: {
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          description:
            'Canonical VFS paths to delete, e.g. ["files/Reports/draft.md"]. Copy paths verbatim from glob/grep/read output. Paths from different categories may be mixed in one call.',
          items: {
            type: 'string',
          },
        },
        toolTitle: {
          type: 'string',
          description:
            'Target-only UI phrase for the action row, e.g. "draft.md" or "3 files", not a full sentence like "Deleting draft.md".',
        },
      },
      required: ['paths', 'toolTitle'],
    },
    resultSchema: undefined,
  },
  run: {
    parameters: {
      properties: {
        context: {
          description: 'Pre-gathered context: workflow state, block IDs, input requirements.',
          type: 'string',
        },
        request: {
          description:
            'What to run or cancel, or what logs to check. Include a known workflow executionId when cancelling.',
          type: 'string',
        },
      },
      required: ['request'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  run_block: {
    parameters: {
      type: 'object',
      properties: {
        blockId: {
          type: 'string',
          description: 'The block ID to run in isolation.',
        },
        executionId: {
          type: 'string',
          description:
            'Optional execution ID to load the snapshot from. Uses latest execution if omitted.',
        },
        useDeployedState: {
          type: 'boolean',
          description:
            'When true, runs the deployed version instead of the live draft. Default: false (draft).',
        },
        workflowId: {
          type: 'string',
          description:
            'ID of the workflow to run. Always pass this explicitly — outside a workflow-scoped chat there is no current workflow to fall back to, and the run is rejected without it.',
        },
        workflow_input: {
          type: 'object',
          description: 'JSON object with key-value mappings where each key is an input field name',
        },
      },
      required: ['workflowId', 'blockId'],
    },
    resultSchema: undefined,
  },
  run_code: {
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'Code to execute. For JS: raw statements auto-wrapped in async context. For Python: full script. For shell: bash script with pre-installed CLI tools. Use each needed secret as {{VAR_NAME}}; the reference resolves to the value exactly as stored.',
        },
        inputs: {
          type: 'object',
          description:
            'Workspace resources to mount into the sandbox. Copy paths verbatim from glob/read/grep output — they are percent-encoded per segment (spaces are %20, an in-name slash is %2F; parentheses and dots stay literal). Both the encoded path and the plain name resolve, so copy the returned path exactly rather than retyping or decoding it.',
          properties: {
            directories: {
              type: 'array',
              description:
                'Workspace folders to mount recursively into the sandbox, including nested files and empty folders.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description:
                      'Canonical VFS folder path, e.g. "files/Reports". By default this mounts at "/home/user/{path}".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Optional full sandbox directory path override. Omit to mount at /home/user/{path}.',
                  },
                },
                required: ['path'],
              },
            },
            files: {
              type: 'array',
              description: 'Workspace files to mount into the sandbox.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description:
                      'Canonical VFS file path, e.g. "files/Reports/sales.csv". By default this mounts at "/home/user/{path}".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Full sandbox path to mount at, e.g. /home/user/inputs/data.csv. STRONGLY RECOMMENDED whenever the file name has spaces or special characters: the default mount path is the percent-ENCODED canonical path (e.g. /home/user/files/Q4%20Sales%20(Final).csv), which code using the human-readable name will not find. Set a simple sandboxPath and read exactly that.',
                  },
                },
                required: ['path'],
              },
            },
            tables: {
              type: 'array',
              description: 'Workspace tables to mount as CSV files.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Canonical VFS table path when available.',
                  },
                  sandboxPath: {
                    type: 'string',
                    description: 'Optional full sandbox path for the mounted CSV.',
                  },
                  tableId: {
                    type: 'string',
                    description: 'Workspace table ID.',
                  },
                },
              },
            },
          },
        },
        language: {
          type: 'string',
          description: 'Execution language.',
          enum: ['javascript', 'python', 'shell'],
        },
        title: {
          type: 'string',
          description:
            'Short user-visible label for this execution, e.g. "Sum June invoices" or "Verify email formats".',
        },
      },
      required: ['code'],
    },
    resultSchema: undefined,
  },
  run_enrichment: {
    parameters: {
      type: 'object',
      properties: {
        enrichmentId: {
          type: 'string',
          description:
            "Which enrichment to run. Discover the full set and each one's inputs/outputs via table_enrichments.list_enrichments.",
          enum: [
            'work-email',
            'phone-number',
            'company-domain',
            'company-info',
            'email-verification',
          ],
        },
        inputs: {
          type: 'object',
          description:
            'Map of the enrichment\'s input id → value, e.g. { "fullName": "Jane Doe", "companyDomain": "acme.com" }. Provide a value for every required input.',
        },
      },
      required: ['enrichmentId', 'inputs'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        matched: {
          type: 'boolean',
          description: 'True when a provider returned a non-empty result.',
        },
        provider: {
          type: ['string', 'null'],
          description:
            'Internal label of the provider that produced the result (billing/diagnostics only — do NOT surface it to the user), or null on no match.',
        },
        result: {
          type: 'object',
          description: 'Mapped output values from the winning provider (empty object on no match).',
        },
      },
      required: ['matched', 'result'],
    },
  },
  run_from_block: {
    parameters: {
      type: 'object',
      properties: {
        executionId: {
          type: 'string',
          description:
            'Optional execution ID to load the snapshot from. Uses latest execution if omitted.',
        },
        startBlockId: {
          type: 'string',
          description: 'The block ID to start execution from.',
        },
        useDeployedState: {
          type: 'boolean',
          description:
            'When true, runs the deployed version instead of the live draft. Default: false (draft).',
        },
        workflowId: {
          type: 'string',
          description:
            'ID of the workflow to run. Always pass this explicitly — outside a workflow-scoped chat there is no current workflow to fall back to, and the run is rejected without it.',
        },
        workflow_input: {
          type: 'object',
          description: 'JSON object with key-value mappings where each key is an input field name',
        },
      },
      required: ['workflowId', 'startBlockId'],
    },
    resultSchema: undefined,
  },
  run_function: {
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'Code to execute. For JS: raw statements auto-wrapped in async context. For Python: full script. For shell: bash script with pre-installed CLI tools. Use each needed secret as {{VAR_NAME}}; the reference resolves to the value exactly as stored.',
        },
        inputs: {
          type: 'object',
          description:
            'Workspace resources to mount into the sandbox. Copy paths verbatim from glob/read/grep output — they are percent-encoded per segment (spaces are %20, an in-name slash is %2F; parentheses and dots stay literal). Both the encoded path and the plain name resolve, so copy the returned path exactly rather than retyping or decoding it.',
          properties: {
            directories: {
              type: 'array',
              description:
                'Workspace folders to mount recursively into the sandbox, including nested files and empty folders.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description:
                      'Canonical VFS folder path, e.g. "files/Reports". By default this mounts at "/home/user/{path}".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Optional full sandbox directory path override. Omit to mount at /home/user/{path}.',
                  },
                },
                required: ['path'],
              },
            },
            files: {
              type: 'array',
              description: 'Workspace files to mount into the sandbox.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description:
                      'Canonical VFS file path, e.g. "files/Reports/sales.csv". By default this mounts at "/home/user/{path}".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Full sandbox path to mount at, e.g. /home/user/inputs/data.csv. STRONGLY RECOMMENDED whenever the file name has spaces or special characters: the default mount path is the percent-ENCODED canonical path (e.g. /home/user/files/Q4%20Sales%20(Final).csv), which code using the human-readable name will not find. Set a simple sandboxPath and read exactly that.',
                  },
                },
                required: ['path'],
              },
            },
            tables: {
              type: 'array',
              description: 'Workspace tables to mount as CSV files.',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Canonical VFS table path when available.',
                  },
                  sandboxPath: {
                    type: 'string',
                    description: 'Optional full sandbox path for the mounted CSV.',
                  },
                  tableId: {
                    type: 'string',
                    description: 'Workspace table ID.',
                  },
                },
              },
            },
          },
        },
        language: {
          type: 'string',
          description: 'Execution language.',
          enum: ['javascript', 'python', 'shell'],
        },
        outputTable: {
          type: 'string',
          description:
            'Table ID to overwrite with the code\'s return value. Code MUST return an array of objects where keys match column names. All existing rows are replaced. Example: "tbl_abc123"',
        },
        outputs: {
          type: 'object',
          description:
            'Workspace files to create or overwrite from returned code results or sandbox-created files.',
          properties: {
            files: {
              type: 'array',
              description:
                'File outputs. Missing parent folders are created automatically for create mode.',
              items: {
                type: 'object',
                properties: {
                  format: {
                    type: 'string',
                    description: 'Optional serialization format for returned values.',
                    enum: ['json', 'csv', 'txt', 'md', 'html'],
                  },
                  mimeType: {
                    type: 'string',
                    description: 'Optional MIME type override when inference is not enough.',
                  },
                  mode: {
                    type: 'string',
                    description: 'Create a new file or overwrite an existing file at path.',
                    enum: ['create', 'overwrite'],
                  },
                  path: {
                    type: 'string',
                    description: 'Canonical destination VFS path, e.g. "files/Reports/chart.png".',
                  },
                  sandboxPath: {
                    type: 'string',
                    description:
                      'Optional full path to a file created inside the sandbox. Omit to save the code return value.',
                  },
                },
                required: ['path', 'mode'],
              },
            },
          },
        },
        sandboxId: {
          type: 'string',
          description:
            'Optional Sim sandbox id from agent/sandboxes/{name}.json. DEFAULT-FIRST: omit this whenever the documented default run_function environment can do the job. Select a ready existing Sim sandbox only when a required third-party dependency, Debian system package, or managed CLI is known to be absent, or a default attempt failed specifically because it was missing. Never guess an id.',
        },
        timeout: {
          type: 'number',
          description:
            'Maximum execution time in SECONDS (Sim converts to milliseconds). The sandbox stops execution and returns a timeout error after this duration. Defaults to 10 seconds and is capped at 300 seconds regardless of plan.',
          default: 10,
        },
        title: {
          type: 'string',
          description:
            'Short user-visible label for this execution, e.g. "Clean customer CSV", "Revenue chart", or "Query GitHub issues".',
        },
      },
      required: ['code'],
    },
    resultSchema: undefined,
  },
  run_workflow: {
    parameters: {
      type: 'object',
      properties: {
        async: {
          type: 'boolean',
          description:
            'Queue the deployed workflow and return its execution ID immediately. Default: false. Set true only when explicitly asked for a background run, or when the three most recent completed runs each exceeded 30 minutes. Fails if the current workflow differs from its deployed version. Missing history, complexity, or one slow run never justify async; check completion later with query_logs.',
        },
        inputFromExecutionId: {
          type: 'string',
          description:
            'Reuse the recorded input from a past execution of this workflow (from query_logs) instead of supplying workflow_input — handy for replaying a run without retyping inputs. The reused input is re-validated against the trigger. Mutually exclusive with workflow_input and useMockPayload.',
        },
        triggerBlockId: {
          type: 'string',
          description:
            'Trigger block ID to run from (from get_workflow_run_options). Required when the workflow has multiple entrypoints.',
        },
        useDeployedState: {
          type: 'boolean',
          description:
            'When true, runs the deployed version instead of the live draft. Default: false (draft).',
        },
        useMockPayload: {
          type: 'boolean',
          description:
            "When true, run with the trigger's generated mock payload instead of workflow_input. Prefer building your own workflow_input; use this only when you can't.",
        },
        workflowId: {
          type: 'string',
          description:
            'ID of the workflow to run. Always pass this explicitly — outside a workflow-scoped chat there is no current workflow to fall back to, and the run is rejected without it.',
        },
        workflow_input: {
          type: 'object',
          description:
            "JSON object matching the target trigger's inputSchema (from get_workflow_run_options). For external/webhook triggers this is the event payload; for API/Input triggers it is the form fields.",
        },
      },
      required: ['workflowId'],
    },
    resultSchema: undefined,
  },
  run_workflow_until_block: {
    parameters: {
      type: 'object',
      properties: {
        inputFromExecutionId: {
          type: 'string',
          description:
            'Reuse the recorded input from a past execution of this workflow (from query_logs) instead of supplying workflow_input. The reused input is re-validated against the trigger. Mutually exclusive with workflow_input and useMockPayload.',
        },
        stopAfterBlockId: {
          type: 'string',
          description: 'The block ID to stop after. Execution halts once this block completes.',
        },
        triggerBlockId: {
          type: 'string',
          description:
            'Trigger block ID to run from (from get_workflow_run_options). Required when the workflow has multiple entrypoints.',
        },
        useDeployedState: {
          type: 'boolean',
          description:
            'When true, runs the deployed version instead of the live draft. Default: false (draft).',
        },
        useMockPayload: {
          type: 'boolean',
          description:
            "When true, run with the trigger's generated mock payload instead of workflow_input. Prefer building your own workflow_input; use this only when you can't.",
        },
        workflowId: {
          type: 'string',
          description:
            'ID of the workflow to run. Always pass this explicitly — outside a workflow-scoped chat there is no current workflow to fall back to, and the run is rejected without it.',
        },
        workflow_input: {
          type: 'object',
          description:
            "JSON object matching the target trigger's inputSchema (from get_workflow_run_options). For external/webhook triggers this is the event payload; for API/Input triggers it is the form fields.",
        },
      },
      required: ['workflowId', 'stopAfterBlockId'],
    },
    resultSchema: undefined,
  },
  save_upload: {
    parameters: {
      type: 'object',
      properties: {
        fileNames: {
          type: 'array',
          description:
            'The names of the uploaded files to materialize (e.g. ["report.pdf", "data.csv"])',
          items: {
            type: 'string',
          },
        },
        operation: {
          type: 'string',
          description:
            'What to do with the file. "save" promotes it to a permanent files/ path. "import" imports a workflow JSON as a workspace workflow. "extract" decompresses a .zip upload into files/<archive>/. Defaults to "save".',
          enum: ['save', 'import', 'extract'],
          default: 'save',
        },
      },
      required: ['fileNames'],
    },
    resultSchema: undefined,
  },
  search: {
    parameters: {
      properties: {
        task: {
          description:
            "One short scoping sentence — the search agent has full conversation context. Example: 'find current Stripe metered-billing API limits' or 'count how many rows in the leads table have invalid emails'.",
          type: 'string',
        },
      },
      required: ['task'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  search_docs: {
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Optional docs/ VFS path (a page such as docs/workflows/blocks/agent.mdx, or a section such as docs/workflows) that limits the search scope',
        },
        query: {
          type: 'string',
          description: 'The search query',
        },
        topK: {
          type: 'number',
          description: 'Number of results (default 5, max 25)',
          default: 5,
        },
      },
      required: ['query'],
    },
    resultSchema: undefined,
  },
  search_integration_tools: {
    parameters: {
      properties: {
        limit: {
          description: 'Maximum matches to return. Defaults to 5.',
          maximum: 10,
          minimum: 1,
          type: 'integer',
        },
        query: {
          description: 'What the service operation must do, in plain language.',
          type: 'string',
        },
        service: {
          description:
            'Optional canonical service name, such as "gmail", "slack", or "google_sheets".',
          type: 'string',
        },
      },
      required: ['query'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  search_knowledge_base: {
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'object',
          description: 'Arguments for the operation',
          properties: {
            knowledgeBaseId: {
              type: 'string',
              description: 'Knowledge base ID (required for all operations)',
            },
            query: {
              type: 'string',
              description: "Search query text (required for 'query')",
            },
            topK: {
              type: 'number',
              description: 'Number of results to return (1-50, default: 5)',
              default: 5,
            },
          },
        },
        operation: {
          type: 'string',
          description: 'The read operation to perform',
          enum: ['get', 'query', 'list_tags'],
        },
      },
      required: ['operation', 'args'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: ['object', 'array'],
          description:
            'Operation-specific result payload. An object for search results; list_tags returns an array of tag definitions.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome summary.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the operation succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  search_library_docs: {
    parameters: {
      type: 'object',
      properties: {
        library_name: {
          type: 'string',
          description: "Name of the library to search for (e.g., 'nextjs', 'stripe', 'langchain')",
        },
        query: {
          type: 'string',
          description: 'The question or topic to find documentation for - be specific',
        },
        version: {
          type: 'string',
          description:
            "Specific version, numeric only and WITHOUT a leading 'v' (e.g. '14', '2', '2.1') — the 'v' is added for you, so 'v2' resolves to nothing.",
        },
      },
      required: ['library_name', 'query'],
    },
    resultSchema: undefined,
  },
  search_workspace: {
    parameters: {
      properties: {
        documentIds: {
          description:
            'Optional document IDs returned by search or selected by the user; narrows retrieval to these documents.',
          items: {
            type: 'string',
          },
          maxItems: 20,
          minItems: 1,
          type: 'array',
        },
        modifiedAfter: {
          description:
            'Optional ISO datetime; restrict results to documents modified after this time.',
          format: 'date-time',
          type: 'string',
        },
        query: {
          description: 'Search query describing the information needed.',
          maxLength: 2000,
          minLength: 1,
          type: 'string',
        },
        source: {
          description:
            'Optional connector type or upload source; can narrow the selected search scope.',
          type: 'string',
        },
        topK: {
          default: 20,
          description: 'Maximum number of matching chunks to return.',
          maximum: 50,
          minimum: 1,
          type: 'integer',
        },
      },
      required: ['query'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  set_block_enabled: {
    parameters: {
      type: 'object',
      properties: {
        blockId: {
          type: 'string',
          description: 'The block ID whose enabled state should be changed.',
        },
        enabled: {
          type: 'boolean',
          description: 'Set to true to enable the block, or false to disable it.',
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID to edit. If not provided, uses the current workflow in context.',
        },
      },
      required: ['blockId', 'enabled'],
    },
    resultSchema: undefined,
  },
  set_environment_variables: {
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description:
            'Whether to set workspace or personal environment variables. Defaults to workspace.',
          enum: ['personal', 'workspace'],
          default: 'workspace',
        },
        variables: {
          type: 'array',
          description: 'List of env vars to set',
          items: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description:
                  'What the variable is for, in one short phrase — aim for under 80 characters, like "Stripe live key for the billing workflow". Not a sentence, and never a restatement of the name. Workspace scope only; sending it with scope personal is rejected. Omit it on an existing variable to leave its current description untouched; send an empty string to clear one. You may send it alone, without a value, to describe a secret that already exists.',
              },
              name: {
                type: 'string',
                description: 'Variable name',
              },
              value: {
                type: 'string',
                description:
                  "Variable value. Omit it to leave an existing variable's value untouched and change only its description — never invent or guess a value you were not given, which would overwrite the real secret.",
              },
            },
            required: ['name'],
          },
        },
      },
      required: ['variables'],
    },
    resultSchema: undefined,
  },
  set_global_workflow_variables: {
    parameters: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: 'List of operations to apply',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Variable name.',
              },
              operation: {
                type: 'string',
                enum: ['add', 'delete', 'edit'],
              },
              type: {
                type: 'string',
                description:
                  'Variable type for add/edit. Defaults to the variable\'s existing type, or "plain" for a new one. Ignored for delete.',
                enum: ['plain', 'number', 'boolean', 'array', 'object'],
              },
              value: {
                type: 'string',
                description:
                  'Variable value for add/edit, coerced to the declared type. Omitting it leaves the variable with no value. Ignored for delete.',
              },
            },
            required: ['operation', 'name'],
          },
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
      required: ['operations'],
    },
    resultSchema: undefined,
  },
  share_file: {
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Whether to create/update the share link or deactivate it.',
          enum: ['share', 'unshare'],
          default: 'share',
        },
        allowedEmails: {
          type: 'array',
          description:
            'Allowed emails or "@domain" patterns for authType "email" or "sso". Ignored for other auth types.',
          items: {
            type: 'string',
          },
        },
        authType: {
          type: 'string',
          description: 'How viewers authenticate to open the link. Ignored for unshare.',
          enum: ['public', 'password', 'email', 'sso'],
          default: 'public',
        },
        password: {
          type: 'string',
          description:
            'Password for authType "password". Leave empty to keep the file\'s existing password when re-sharing an already password-protected file. Ignored for other auth types.',
        },
        path: {
          type: 'string',
          description: 'Canonical workspace file VFS path to share, e.g. "files/Reports/Q4.md".',
        },
      },
      required: ['path'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description:
            'Share state. Contains url (the {baseUrl}/f/{token} link), token, authType, hasPassword, and isActive.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the share action succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  steer_agent: {
    parameters: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'The agent id to steer.',
        },
        content: {
          type: 'string',
          description:
            'The instruction to deliver, phrased as you would brief a teammate mid-task.',
        },
      },
      required: ['agent_id', 'content'],
    },
    resultSchema: undefined,
  },
  table: {
    parameters: {
      properties: {
        request: {
          description: 'What table action is needed.',
          type: 'string',
        },
        sessionId: {
          description:
            'Reusable session ID returned by an earlier table call in this chat. Supply it only on a later user message that continues the same task, and at most once per user message. Omit it for a new or independent task.',
          type: 'string',
        },
        title: {
          description:
            "Required private orchestration label (3–8 words) for this session's stable objective. Stored in the request-local, chat-scoped Subagent Registry supplied only to the main orchestrator; not shown to the table agent. When resuming with sessionId, copy the registry title unchanged.",
          maxLength: 120,
          type: 'string',
        },
      },
      required: ['request', 'title'],
      type: 'object',
    },
    resultSchema: undefined,
  },
  table_automations: {
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'object',
          description: 'Arguments for the operation',
          properties: {
            autoRun: {
              type: 'boolean',
              description:
                "On add: true fires dep-satisfied rows immediately (only when the user explicitly asked); default false stages silently. On update: toggles the group's auto-fire on dep satisfaction.",
            },
            blockId: {
              type: 'string',
              description: 'Source block ID inside the workflow (add_workflow_group_output)',
            },
            columnName: {
              type: 'string',
              description:
                'Target column name: required for delete_workflow_group_output (the bound column to drop); optional for add_workflow_group_output (auto-derived from path)',
            },
            dependencies: {
              type: 'object',
              description:
                'Dependencies before a row runs: { columns?: string[] } of input column names that must be filled. Output columns of upstream groups are valid; a group cannot depend on its own outputs.',
              properties: {
                columns: {
                  type: 'array',
                  description:
                    'Input column names that must be filled before the group runs a row.',
                  items: {
                    type: 'string',
                  },
                },
              },
            },
            groupId: {
              type: 'string',
              description:
                'Workflow group ID (required for update_workflow_group, delete_workflow_group, add_workflow_group_output, delete_workflow_group_output)',
            },
            groupIds: {
              type: 'array',
              description: 'Workflow group IDs to fire (required for run_column, non-empty)',
              items: {
                type: 'string',
              },
            },
            mappingUpdates: {
              type: 'array',
              description:
                'Surgical per-output remap for update_workflow_group: each entry repoints ONE existing output column to a new (blockId, path) without touching the rest. Stale cells clear and backfill from saved execution logs where possible. Discover valid pairs via list_workflow_outputs first.',
              items: {
                type: 'object',
                properties: {
                  blockId: {
                    type: 'string',
                    description: 'New source block ID for this column.',
                  },
                  columnName: {
                    type: 'string',
                    description:
                      'The existing output column to remap (must be bound to this group).',
                  },
                  path: {
                    type: 'string',
                    description: 'New dotted output path on the new block.',
                  },
                },
                required: ['columnName', 'blockId', 'path'],
              },
            },
            name: {
              type: 'string',
              description: 'Display name for the group (optional on add/update)',
            },
            outputPath: {
              type: 'string',
              description:
                'Write this call\'s result to a NEW workspace file instead of returning it (e.g. "files/export.csv"). On success the tool result is REPLACED by a file receipt (fileId, vfsPath, size) — set it only when the file IS the goal. ".csv" serializes rows as a CSV table; ".json"/".txt"/".md"/".html" write pretty-printed JSON of the full result envelope. Missing parent folders are created; an existing path fails.',
            },
            outputs: {
              type: 'array',
              description:
                'Outputs to surface as columns for add_workflow_group: each { blockId, path, columnName?, columnType? }; columnName auto-derives from path, columnType from the leaf type. Validated against list_workflow_outputs — invalid picks return the valid options. For update_workflow_group prefer add/delete_workflow_group_output and mappingUpdates; pass outputs only to restructure the whole set.',
              items: {
                type: 'object',
                properties: {
                  blockId: {
                    type: 'string',
                    description: 'Source block ID inside the workflow.',
                  },
                  columnName: {
                    type: 'string',
                    description:
                      'Optional target column name; auto-derived from the path when omitted.',
                  },
                  columnType: {
                    type: 'string',
                    description: 'Optional column type; defaults from the leaf type when omitted.',
                    enum: ['string', 'number', 'boolean', 'date', 'json'],
                  },
                  path: {
                    type: 'string',
                    description: 'Dotted output path on the block.',
                  },
                },
                required: ['blockId', 'path'],
              },
            },
            path: {
              type: 'string',
              description: 'Dotted output path on the block (add_workflow_group_output)',
            },
            rowId: {
              type: 'string',
              description: 'Row ID for cancel_table_runs with scope "row".',
            },
            rowIds: {
              type: 'array',
              description:
                'Optional row scope for run_column: only these rows are candidates (server eligibility still applies); omit for the whole table.',
              items: {
                type: 'string',
              },
            },
            runMode: {
              type: 'string',
              description:
                'Run mode for run_column: "incomplete" (default) re-runs only rows with no output or a last failure; "all" re-runs every dep-satisfied row.',
              enum: ['incomplete', 'all'],
            },
            scope: {
              type: 'string',
              description:
                'Cancellation scope for cancel_table_runs: "all" (whole table) or "row" (requires rowId).',
              enum: ['all', 'row'],
            },
            tableId: {
              type: 'string',
              description: 'Table ID (required for everything except list_workflow_outputs)',
            },
            workflowId: {
              type: 'string',
              description:
                'Workflow ID (required for add_workflow_group and list_workflow_outputs)',
            },
          },
        },
        operation: {
          type: 'string',
          description: 'The automation operation to perform',
          enum: [
            'list_workflow_outputs',
            'add_workflow_group',
            'update_workflow_group',
            'delete_workflow_group',
            'add_workflow_group_output',
            'delete_workflow_group_output',
            'run_column',
            'cancel_table_runs',
          ],
        },
      },
      required: ['operation', 'args'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Operation-specific result payload.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome summary.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the operation succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  table_columns: {
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'object',
          description: 'Arguments for the operation',
          properties: {
            column: {
              type: 'object',
              description:
                'Column definition for add_column: { name, type, unique?, position? }; type may be string, number, boolean, date, json, select, or ttl. Select (enum) columns also take { options: [names], multiple?: true } — options is required for select. A table may have at most one ttl column; adding it enables row expiration, with cell values stored as absolute whole Unix epoch seconds rather than milliseconds.',
            },
            columnName: {
              type: 'string',
              description:
                'Column name (required for rename_column and update_column; single-column delete_column)',
            },
            columnNames: {
              type: 'array',
              description:
                'Array of column names to delete at once (preferred for multi-column delete_column)',
              items: {
                type: 'string',
              },
            },
            multiple: {
              type: 'boolean',
              description:
                'Whether a select cell may hold several options (default false). Switching true → false fails if any row has more than one selected.',
            },
            newName: {
              type: 'string',
              description: 'New column name (required for rename_column)',
            },
            newType: {
              type: 'string',
              description:
                'New column type for update_column: string, number, boolean, date, json, select, ttl. Converting to select also requires options; conversion fails if an existing cell value matches no option. A multiple select round-trips through text as a comma-separated cell. Converting to ttl enables row expiration and fails if the table already has another ttl column; TTL values are absolute whole Unix epoch seconds, not milliseconds.',
            },
            options: {
              type: 'array',
              description:
                'Choices for a select (enum) column as display names, e.g. ["Open", "Closed"]. Required when creating or converting to select. On update_column this REPLACES the whole list, matched BY NAME — send the full list including options you keep; omitting one deletes it and clears its cells. Max 100.',
              items: {
                type: 'string',
              },
            },
            outputPath: {
              type: 'string',
              description:
                'Write this call\'s result to a NEW workspace file instead of returning it (e.g. "files/export.csv"). On success the tool result is REPLACED by a file receipt (fileId, vfsPath, size) — set it only when the file IS the goal. ".csv" serializes rows as a CSV table; ".json"/".txt"/".md"/".html" write pretty-printed JSON of the full result envelope. Missing parent folders are created; an existing path fails.',
            },
            tableId: {
              type: 'string',
              description: 'Table ID (required for every operation)',
            },
            unique: {
              type: 'boolean',
              description:
                'Set or clear the column unique constraint (update_column; not supported on select columns)',
            },
          },
          required: ['tableId'],
        },
        operation: {
          type: 'string',
          description: 'The column operation to perform',
          enum: ['add_column', 'rename_column', 'delete_column', 'update_column'],
        },
      },
      required: ['operation', 'args'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Operation-specific result payload.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome summary.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the operation succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  table_enrichments: {
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'object',
          description: 'Arguments for the operation',
          properties: {
            autoRun: {
              type: 'boolean',
              description:
                'true fires dep-satisfied rows immediately on add (only when the user explicitly asked); default false stages silently — fire later via table_automations run_column.',
            },
            dependencies: {
              type: 'object',
              description:
                'Optional dependency override: { columns?: string[] }; omit to default to the mapped input columns.',
              properties: {
                columns: {
                  type: 'array',
                  description:
                    'Input column names that must be filled before the enrichment runs a row.',
                  items: {
                    type: 'string',
                  },
                },
              },
            },
            enrichmentId: {
              type: 'string',
              description:
                'Enrichment registry ID for add_enrichment — discover via list_enrichments (e.g. work-email, phone-number, company-domain, company-info).',
            },
            inputMappings: {
              type: 'array',
              description:
                'For add_enrichment: binds each enrichment input to an existing table column, as { inputName, columnName } where inputName is the enrichment input id from list_enrichments. Provide one for every required input.',
              items: {
                type: 'object',
                properties: {
                  columnName: {
                    type: 'string',
                    description: 'Existing table column that supplies this input.',
                  },
                  inputName: {
                    type: 'string',
                    description: 'Enrichment input id to bind (from list_enrichments).',
                  },
                },
                required: ['inputName', 'columnName'],
              },
            },
            name: {
              type: 'string',
              description:
                "Optional display name for the enrichment column group; defaults to the enrichment's registry name.",
            },
            outputColumnNames: {
              type: 'object',
              description:
                'Optional output column name overrides, as { "<outputId>": "<columnName>" }; omit for defaults.',
              additionalProperties: {
                type: 'string',
                description: 'Target column name for this enrichment output id.',
              },
            },
            outputPath: {
              type: 'string',
              description:
                'Write this call\'s result to a NEW workspace file instead of returning it (e.g. "files/export.csv"). On success the tool result is REPLACED by a file receipt (fileId, vfsPath, size) — set it only when the file IS the goal. ".csv" serializes rows as a CSV table; ".json"/".txt"/".md"/".html" write pretty-printed JSON of the full result envelope. Missing parent folders are created; an existing path fails.',
            },
            tableId: {
              type: 'string',
              description: 'Table ID (required for add_enrichment)',
            },
          },
        },
        operation: {
          type: 'string',
          description: 'The enrichment operation to perform',
          enum: ['list_enrichments', 'add_enrichment'],
        },
      },
      required: ['operation', 'args'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Operation-specific result payload.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome summary.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the operation succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  table_manage: {
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'object',
          description: 'Arguments for the operation',
          properties: {
            description: {
              type: 'string',
              description: 'Table description (optional for create)',
            },
            filePath: {
              type: 'string',
              description:
                'Canonical workspace file VFS path for create_from_file / import_file, e.g. files/{path}/{name}',
            },
            mapping: {
              type: 'object',
              description:
                'Optional explicit CSV-header → table-column mapping for import_file, as { "csvHeader": "columnName" | null }. null skips that header; omit a header to auto-map by sanitized name.',
              additionalProperties: {
                type: ['string', 'null'],
                description: 'Target column name on the table; null skips that CSV header.',
              },
            },
            mode: {
              type: 'string',
              description:
                'Import mode for import_file: append (default) adds rows; replace truncates existing rows in a transaction first.',
              enum: ['append', 'replace'],
            },
            name: {
              type: 'string',
              description: 'Table name (required for create)',
            },
            newName: {
              type: 'string',
              description: 'New table name (required for rename)',
            },
            outputPath: {
              type: 'string',
              description:
                'Write this call\'s result to a NEW workspace file instead of returning it (e.g. "files/export.csv"). On success the tool result is REPLACED by a file receipt (fileId, vfsPath, size) — set it only when the file IS the goal. ".csv" serializes rows as a CSV table; ".json"/".txt"/".md"/".html" write pretty-printed JSON of the full result envelope. Missing parent folders are created; an existing path fails.',
            },
            schema: {
              type: 'object',
              description:
                'Table schema with a columns array (required for create). Each column: { name, type, unique? }; types are string, number, boolean, date, json, select, and ttl. A select (enum) column also requires options (display names) and takes multiple?. A table may have at most one ttl column; adding it enables row expiration, with cell values stored as absolute whole Unix epoch seconds rather than milliseconds.',
            },
            tableId: {
              type: 'string',
              description: 'Table ID (required for import_file and rename)',
            },
          },
        },
        operation: {
          type: 'string',
          description: 'The lifecycle operation to perform',
          enum: ['create', 'create_from_file', 'import_file', 'rename'],
        },
      },
      required: ['operation', 'args'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Operation-specific result payload.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome summary.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the operation succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  table_rows: {
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'object',
          description: 'Arguments for the operation',
          properties: {
            columnName: {
              type: 'string',
              description: 'Column to set when using the values map format of batch_update_rows',
            },
            data: {
              type: 'object',
              description:
                'Row data as column → value pairs (required for insert_row, update_row; the patch object for update_rows_by_filter). Select (enum) cells take the option NAME. TTL cells take absolute whole Unix epoch seconds, never JavaScript milliseconds. On insert_row, a missing or null TTL means no expiration. On update_row and update_rows_by_filter, omit the TTL to preserve its current value or set it to null to clear the expiration.',
            },
            filter: {
              type: 'object',
              description:
                'Predicate filter for update_rows_by_filter / delete_rows_by_filter: {"all":[...]} (AND) or {"any":[...]} (OR) of {field, op, value} leaves or nested groups. Ops: eq, ne, gt, gte, lt, lte, in, nin, like, ilike (* wildcard), nlike, nilike, contains, ncontains, startsWith, endsWith, isNull, isNotNull, isEmpty, isNotEmpty. in/nin take a non-empty array. Single-select columns match by eq/ne/in/nin; multiple-select by contains/ncontains — values are option NAMES. TTL filter values are absolute whole Unix epoch seconds.',
            },
            limit: {
              type: 'number',
              description:
                'Optional cap on affected rows for the by-filter operations; omit to act on every match.',
            },
            outputPath: {
              type: 'string',
              description:
                'Write this call\'s result to a NEW workspace file instead of returning it (e.g. "files/export.csv"). On success the tool result is REPLACED by a file receipt (fileId, vfsPath, size) — set it only when the file IS the goal. ".csv" serializes rows as a CSV table; ".json"/".txt"/".md"/".html" write pretty-printed JSON of the full result envelope. Missing parent folders are created; an existing path fails.',
            },
            position: {
              type: 'integer',
              description:
                'Zero-based index at which to insert the row (optional, insert_row only). Rows at and below shift down; omit to append.',
            },
            rowId: {
              type: 'string',
              description: 'Row ID (required for update_row, delete_row)',
            },
            rowIds: {
              type: 'array',
              description: 'Array of row IDs to delete (required for batch_delete_rows)',
              items: {
                type: 'string',
              },
            },
            rows: {
              type: 'array',
              description:
                'Array of row data objects (required for batch_insert_rows). TTL cells take absolute whole Unix epoch seconds, never JavaScript milliseconds; a missing or null TTL means no expiration.',
              items: {
                type: 'object',
              },
            },
            tableId: {
              type: 'string',
              description: 'Table ID (required for every operation)',
            },
            updates: {
              type: 'array',
              description:
                "Array of per-row updates: [{ rowId, data: { col: val } }] (batch_update_rows format a). TTL values are absolute whole Unix epoch seconds, never JavaScript milliseconds; omit a row's TTL key to preserve it or set it to null to clear the expiration.",
              items: {
                type: 'object',
                properties: {
                  data: {
                    type: 'object',
                  },
                  rowId: {
                    type: 'string',
                  },
                },
                required: ['rowId', 'data'],
              },
            },
            values: {
              type: 'object',
              description:
                "Map of rowId → value for single-column batch update (batch_update_rows format b, with columnName). For a TTL column, values are absolute whole Unix epoch seconds, never JavaScript milliseconds; set a row's value to null to clear its expiration, and omit the row from the map to leave it unchanged.",
            },
          },
          required: ['tableId'],
        },
        operation: {
          type: 'string',
          description: 'The row operation to perform',
          enum: [
            'insert_row',
            'batch_insert_rows',
            'update_row',
            'batch_update_rows',
            'delete_row',
            'batch_delete_rows',
            'update_rows_by_filter',
            'delete_rows_by_filter',
          ],
        },
      },
      required: ['operation', 'args'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Operation-specific result payload.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome summary.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the operation succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  table_views: {
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'object',
          description: 'Arguments for the operation',
          properties: {
            filter: {
              type: ['object', 'null'],
              description:
                'Saved row predicate, same grammar as query_rows filters: {"all":[...]} / {"any":[...]} of {field, op, value} leaves with exact column NAMES. On update_view, omit to keep the existing filter, pass null to clear it, or pass a predicate to replace it. On create_view, omit or pass null for an unfiltered view.',
            },
            hiddenColumns: {
              type: 'array',
              description:
                'Column names to hide in the UI when this view is active. Display-only — queries through the view still return every column.',
              items: {
                type: 'string',
              },
            },
            isDefault: {
              type: 'boolean',
              description:
                "Make this view the table's default (at most one per table; setting it clears the previous default).",
            },
            name: {
              type: 'string',
              description:
                'View display name (required for create_view; optional rename on update_view). Free-form label; references always use the view ID, so names are purely display.',
            },
            sort: {
              type: ['array', 'null'],
              description:
                'Saved ordered sort spec, e.g. [{"field":"due","direction":"asc"}], column NAMES. On update_view, omit to keep the existing sort, pass null to clear it, or pass a sort spec to replace it. On create_view, omit or pass null for default ordering.',
              items: {
                type: 'object',
                properties: {
                  direction: {
                    type: 'string',
                    enum: ['asc', 'desc'],
                  },
                  field: {
                    type: 'string',
                  },
                },
                required: ['field', 'direction'],
              },
            },
            tableId: {
              type: 'string',
              description: 'Table ID (required for every operation)',
            },
            viewId: {
              type: 'string',
              description:
                'View ID (required for get_view, update_view, delete_view, set_default_view)',
            },
          },
          required: ['tableId'],
        },
        operation: {
          type: 'string',
          description: 'The view operation to perform',
          enum: [
            'list_views',
            'get_view',
            'create_view',
            'update_view',
            'delete_view',
            'set_default_view',
          ],
        },
      },
      required: ['operation', 'args'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Operation-specific result payload.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome summary.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the operation succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  tail_agent: {
    parameters: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'The agent id to inspect.',
        },
        max_chars: {
          type: 'number',
          description:
            'Max characters of activity to return. Default 4000; unread activity beyond the budget stays queued for your next tail.',
        },
      },
      required: ['agent_id'],
    },
    resultSchema: undefined,
  },
  terminal: {
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'object',
          description: 'Inputs for the operation. Pass only the fields that operation uses.',
          properties: {
            command: {
              type: 'string',
              description:
                'For run: the command line, exactly as it would be typed at the prompt. Shell syntax (pipes, &&, quoting, redirection) works because a real shell interprets it.',
            },
            cwd: {
              type: 'string',
              description:
                "For new: absolute path to open in. Defaults to the active terminal's directory.",
            },
            key: {
              type: 'string',
              description:
                'For input: a single key to press instead of text. Use "enter" to submit something already typed.',
              enum: [
                'ctrl-c',
                'ctrl-d',
                'ctrl-z',
                'enter',
                'up',
                'down',
                'left',
                'right',
                'escape',
                'tab',
              ],
            },
            keys: {
              type: 'array',
              description:
                'For input: several keys pressed in order, e.g. ["down","down","enter"] to walk down a menu and choose. Each is a real keypress with a pause between, so the program redraws as it would under a person\'s hands. Only batch when you already know where the highlight is — read the screen first, and press one key at a time when you do not. Max 20.',
              items: {
                type: 'string',
                enum: [
                  'ctrl-c',
                  'ctrl-d',
                  'ctrl-z',
                  'enter',
                  'up',
                  'down',
                  'left',
                  'right',
                  'escape',
                  'tab',
                ],
              },
            },
            lines: {
              type: 'number',
              description: 'For read: how many trailing lines to return. Defaults to 200.',
            },
            pane: {
              type: 'string',
              description:
                "Which tmux pane to act on, as a target from the panes operation (session:window.pane). Defaults to that session's active pane. Ignored when the terminal is a plain shell.",
            },
            reason: {
              type: 'string',
              description:
                'For handoff: what the user needs to do, shown on the button they click (e.g. "Enter your sudo password"). Say what is being asked, not that you are waiting.',
            },
            signal: {
              type: 'string',
              description:
                'For kill: which signal. Defaults to SIGINT, the equivalent of the user pressing Ctrl-C.',
              enum: ['SIGINT', 'SIGTERM', 'SIGKILL'],
            },
            terminalId: {
              type: 'string',
              description:
                'Which terminal to act on, from the list operation. Defaults to the active one, which is what the user is looking at. Required by switch and close.',
            },
            text: {
              type: 'string',
              description:
                'For input: literal text to type. A trailing newline submits it. Check the returned screen to confirm it submitted rather than sitting unsent in an input box.',
            },
            waitSeconds: {
              type: 'number',
              description:
                'For run: how long to wait before handing back a still-running command. Defaults to 30, capped at 120. Raising it does not make a command finish sooner, it only delays your first look at it.',
            },
          },
        },
        operation: {
          type: 'string',
          description: 'What to do.',
          enum: [
            'run',
            'read',
            'input',
            'kill',
            'cwd',
            'list',
            'new',
            'switch',
            'close',
            'panes',
            'handoff',
          ],
        },
      },
      required: ['operation'],
    },
    resultSchema: undefined,
  },
  update_deployment_version: {
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description:
            'New description for the deployment version. Provide name and/or description.',
        },
        name: {
          type: 'string',
          description:
            'New name/label for the deployment version. Provide name and/or description.',
        },
        version: {
          type: 'number',
          description:
            'The numeric deployment version number to update (use list_deployment_versions to find it).',
        },
        workflowId: {
          type: 'string',
          description:
            'Optional workflow ID. If not provided, uses the current workflow in context.',
        },
      },
      required: ['version'],
    },
    resultSchema: undefined,
  },
  update_workspace_mcp_server: {
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'New description for the server',
        },
        isPublic: {
          type: 'boolean',
          description: 'Whether the server is publicly accessible',
        },
        name: {
          type: 'string',
          description: 'New name for the server',
        },
        serverId: {
          type: 'string',
          description: 'Required: the MCP server ID to update',
        },
      },
      required: ['serverId'],
    },
    resultSchema: undefined,
  },
  user_table: {
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'object',
          description: 'Arguments for the operation',
          properties: {
            autoRun: {
              type: 'boolean',
              description:
                "Optional flag for add_workflow_group, add_enrichment, and update_workflow_group. On add (workflow group or enrichment): when true, existing rows whose dependencies are already filled run immediately; default false stages the group silently — call run_column when ready to fire rows. On update: toggle a group's auto-fire behavior on an existing group — false stages it (no auto-runs on dep satisfaction; only manual run_column fires rows), true re-enables auto-fire (rows whose deps fill will be scheduled). Set true on add only if the user explicitly asked to start runs immediately.",
            },
            blockId: {
              type: 'string',
              description:
                'Source block ID inside the workflow. Used by add_workflow_group_output.',
            },
            column: {
              type: 'object',
              description:
                'Column definition for add_column: { name, type, unique?, position? }. Type may be string, number, boolean, date, json, select, or ttl. For a select (enum) column also pass { options: ["Open", "Closed"], multiple?: true } — options is a list of display names and is required for select. A table may have at most one ttl column; adding it enables row expiration, with cell values stored as absolute whole Unix epoch seconds rather than milliseconds.',
            },
            columnName: {
              type: 'string',
              description:
                'Column name. Required for rename_column, update_column, and delete_workflow_group_output (the bound column to drop). Optional for add_workflow_group_output (auto-derived from path when omitted). Use columnNames array for batch delete_column.',
            },
            columnNames: {
              type: 'array',
              description:
                'Array of column names to delete at once (for delete_column). Preferred over columnName when deleting multiple columns.',
              items: {
                type: 'string',
              },
            },
            cursor: {
              type: 'string',
              description:
                'Opaque pagination cursor for query_rows (optional). Omit for the first page; to fetch the next page, pass back the nextCursor from the previous result\'s "more available" message verbatim. Cannot be combined with a fresh order — the cursor already encodes the paging position.',
            },
            data: {
              type: 'object',
              description:
                'Row data as key-value pairs (required for insert_row, update_row). TTL cells take absolute whole Unix epoch seconds, never JavaScript milliseconds. On insert_row, a missing or null TTL means no expiration. On update_row, omit the TTL to preserve its current value or set it to null to clear the expiration.',
            },
            dependencies: {
              type: 'object',
              description:
                "Dependencies the group requires before running a row. { columns?: string[] } lists input column names that must be filled. Workflow output columns count too — depend on the column produced by an upstream group, not the group itself. The dep graph is column-induced. A group can't depend on its own output columns. Used by add_workflow_group and update_workflow_group, and optionally by add_enrichment (omit and the handler defaults deps to the mapped input columns).",
              properties: {
                columns: {
                  type: 'array',
                  description:
                    'Input column names that must be filled before the group runs. Plain columns and upstream-group output columns are both valid here.',
                  items: {
                    type: 'string',
                  },
                },
              },
            },
            description: {
              type: 'string',
              description: "Table description (optional for 'create')",
            },
            enrichmentId: {
              type: 'string',
              description:
                "Enrichment registry ID for add_enrichment. Discover the available IDs (and each one's inputs/outputs) via list_enrichments first — don't hardcode. Examples: work-email, phone-number, company-domain, company-info.",
            },
            filePath: {
              type: 'string',
              description:
                'Canonical workspace file VFS path for create_from_file/import_file, e.g. files/{path}/{name}.',
            },
            filter: {
              type: 'object',
              description:
                'Predicate filter object for query_rows, update_rows_by_filter, delete_rows_by_filter. A predicate is a tree: {"all":[...]} (AND) or {"any":[...]} (OR); members are leaves {field, op, value} or nested groups. Ops: eq, ne, gt, gte, lt, lte, in, nin, like, ilike (use * as the wildcard), nlike, nilike, contains, ncontains, startsWith, endsWith, isNull, isNotNull, isEmpty, isNotEmpty. in/nin take a non-empty array value. TTL filter values are absolute whole Unix epoch seconds, never milliseconds. Examples: {"all":[{"field":"status","op":"eq","value":"active"}]}; {"all":[{"field":"wins","op":"gte","value":18},{"field":"status","op":"eq","value":"pending"}]}; {"any":[{"field":"status","op":"eq","value":"active"},{"field":"status","op":"eq","value":"pending"}]}; {"all":[{"field":"name","op":"ilike","value":"*jo*"}]}; {"all":[{"field":"slack_user_id","op":"in","value":["U1","U2"]}]}.',
            },
            groupId: {
              type: 'string',
              description:
                'Workflow group ID. Required for update_workflow_group, delete_workflow_group, add_workflow_group_output, delete_workflow_group_output.',
            },
            groupIds: {
              type: 'array',
              description:
                'Array of workflow group IDs. Required for run_column — non-empty list of columns to run.',
              items: {
                type: 'string',
              },
            },
            inputMappings: {
              type: 'array',
              description:
                'For add_enrichment: maps each enrichment input to an existing table column. Each item is { inputName, columnName } where inputName is the enrichment input id (from list_enrichments) and columnName is an existing column on the table. Provide a mapping for every required input. (The field is named inputName for consistency with workflow-group input mappings; for enrichments it holds the enrichment input id.)',
              items: {
                type: 'object',
                properties: {
                  columnName: {
                    type: 'string',
                    description: 'Existing table column name that supplies this input.',
                  },
                  inputName: {
                    type: 'string',
                    description: 'Enrichment input id to bind (from list_enrichments).',
                  },
                },
                required: ['inputName', 'columnName'],
              },
            },
            limit: {
              type: 'number',
              description:
                'Maximum rows per page for query_rows (optional). Omit to fetch the ENTIRE matching result in one response — the call fails if the result exceeds the 5MB budget (narrow with a filter or set a limit). With a limit, a page may end early at the byte budget with more remaining; a non-null nextCursor in the result means more rows exist (continue with cursor). On update_rows_by_filter / delete_rows_by_filter, caps affected rows; omit to act on every match.',
            },
            mapping: {
              type: 'object',
              description:
                'Optional explicit CSV-header → table-column mapping for import_file, as { "csvHeader": "columnName" | null }. A string maps the CSV header to that table column; null skips that CSV header (it won\'t be imported); omit a header entirely to fall back to auto-mapping by sanitized name (case-insensitive).',
              additionalProperties: {
                type: ['string', 'null'],
                description:
                  "Target column name on the table. null skips that CSV header (it won't be imported); omit it entirely to fall back to auto-mapping.",
              },
            },
            mappingUpdates: {
              type: 'array',
              description:
                "Surgical per-output remap for update_workflow_group. Each entry repoints ONE existing output column to a new (blockId, path) without touching the rest of the group. Use this when the user wants to swap which block output flows into a column (e.g. 'point the score column at the new agent block') — the bound column stays, only its source pair changes. Stale row data for remapped columns is cleared and backfilled from saved execution logs where possible (no re-run needed). Use this INSTEAD of resending the full outputs array when the change is scoped to a few columns; use outputs only when the whole group's output set is being restructured. Discover valid (blockId, path) pairs via list_workflow_outputs first.",
              items: {
                type: 'object',
                properties: {
                  blockId: {
                    type: 'string',
                    description: 'New source block ID for this column.',
                  },
                  columnName: {
                    type: 'string',
                    description:
                      'The existing output column to remap. Must already be bound to this group.',
                  },
                  path: {
                    type: 'string',
                    description: 'New dotted output path on the new block.',
                  },
                },
                required: ['columnName', 'blockId', 'path'],
              },
            },
            mode: {
              type: 'string',
              description:
                "Import mode for import_file. 'append' (default) adds rows; 'replace' truncates existing rows in a transaction before inserting the new rows.",
              enum: ['append', 'replace'],
            },
            multiple: {
              type: 'boolean',
              description:
                'Whether a select (enum) cell may hold several options (default false). Switching an existing column from true to false fails if any row has more than one option selected.',
            },
            name: {
              type: 'string',
              description:
                "Table name (required for 'create'). Also the optional display name for add_enrichment — defaults to the enrichment's registry name when omitted.",
            },
            newName: {
              type: 'string',
              description:
                'New name. Required for rename_column (new column name) and for rename (new table name).',
            },
            newType: {
              type: 'string',
              description:
                'New column type (optional for update_column). Types: string, number, boolean, date, json, select, ttl. Converting a column to select also requires options; the conversion fails if any existing cell value doesn\'t match one of them. Converting to a multiple: true select also accepts a comma-separated cell ("Open, Urgent"), which is the form a multi column converts to text as — so multiselect → text → multiselect round-trips. Converting to ttl enables row expiration and fails if the table already has another ttl column; TTL values are absolute whole Unix epoch seconds, not milliseconds.',
            },
            options: {
              type: 'array',
              description:
                'Choices for a select (enum) column, as a list of display names, e.g. ["Open", "Closed"]. Required when creating or converting to a select column. On update_column this REPLACES the option list and is matched against the current one BY NAME: a name still present keeps its cells, a name no longer present is removed and cleared from every cell that held it. Send the full list including the options you are keeping — omitting one deletes it. There is no in-place rename, so re-sending an option under a new name clears the cells that held the old one. Max 100.',
              items: {
                type: 'string',
              },
            },
            order: {
              type: 'array',
              description:
                'Sort spec for query_rows (optional). Ordered list of {field, direction} where direction is asc or desc, e.g. [{"field":"wins","direction":"desc"},{"field":"name","direction":"asc"}].',
              items: {
                type: 'object',
                properties: {
                  direction: {
                    type: 'string',
                    enum: ['asc', 'desc'],
                  },
                  field: {
                    type: 'string',
                  },
                },
                required: ['field', 'direction'],
              },
            },
            outputColumnNames: {
              type: 'object',
              description:
                'Optional output column name overrides for add_enrichment, as { "<outputId>": "<columnName>" }. Omit to use each enrichment output\'s default name.',
              additionalProperties: {
                type: 'string',
                description: 'Target column name for this enrichment output id.',
              },
            },
            outputFormat: {
              type: 'string',
              description:
                'Explicit format override for outputPath. Only "csv" changes the file\'s CONTENT (rows serialized as a CSV table); "json", "txt", "md" and "html" all write the same pretty-printed JSON and change only the stored MIME type. Usually unnecessary — the extension already selects the format.',
              enum: ['json', 'csv', 'txt', 'md', 'html'],
            },
            outputPath: {
              type: 'string',
              description:
                'Write this call\'s result to a NEW workspace file instead of returning it. Applies to EVERY user_table operation, not just query_rows: on success the tool result is REPLACED by a file receipt (fileId, vfsPath, size), so the operation\'s own payload is no longer visible to you — set it only when the file IS the goal. Only ".csv" changes serialization (query_rows rows become a CSV table); ".json", ".txt", ".md" and ".html" all write pretty-printed JSON of the full { success, message, data } envelope and differ only in stored MIME type. Nested paths like "files/Reports/export.csv" work — missing parent folders are created automatically, and an existing path fails.',
            },
            outputs: {
              type: 'array',
              description:
                "Outputs to surface as columns. Each entry maps a workflow block output to a table column: { blockId, path, columnName?, columnType? }. blockId is the source block; path is the dotted output path; columnName auto-derives from the path when omitted; columnType defaults from the leaf type when omitted. Used by add_workflow_group for the full output set. For update_workflow_group, prefer add_workflow_group_output / delete_workflow_group_output for individual outputs and mappingUpdates for surgical remap; only pass outputs here when restructuring the whole group's output set in one shot. If unsure about valid (blockId, path) pairs, call list_workflow_outputs first — paths are validated against the live workflow and invalid picks return an error with the valid options. For Agent blocks with structured outputs, the structured fields appear as top-level paths (e.g. summary, industry); there is NO response.content path on a structured agent.",
              items: {
                type: 'object',
                properties: {
                  blockId: {
                    type: 'string',
                    description: 'Source block ID inside the workflow.',
                  },
                  columnName: {
                    type: 'string',
                    description:
                      'Optional target column name. Auto-derived from the path when omitted.',
                  },
                  columnType: {
                    type: 'string',
                    description: 'Optional column type. Defaults from the leaf type when omitted.',
                    enum: ['string', 'number', 'boolean', 'date', 'json'],
                  },
                  path: {
                    type: 'string',
                    description: 'Dotted output path on the block.',
                  },
                },
                required: ['blockId', 'path'],
              },
            },
            path: {
              type: 'string',
              description: 'Dotted output path on the block. Used by add_workflow_group_output.',
            },
            position: {
              type: 'integer',
              description:
                'Zero-based index at which to insert the row (optional, insert_row only). Rows at and below that index shift down. Omit to append at the end.',
            },
            rowId: {
              type: 'string',
              description:
                "Row ID. Required for get_row, update_row, delete_row, and for cancel_table_runs when scope:'row'.",
            },
            rowIds: {
              type: 'array',
              description:
                'Array of row IDs. Used by batch_delete_rows (rows to delete) and run_column (optional row scope — when omitted, runs across the whole table; when provided, only these rows are candidates and the server eligibility predicate still applies).',
              items: {
                type: 'string',
              },
            },
            rows: {
              type: 'array',
              description:
                'Array of row data objects (required for batch_insert_rows). TTL cells take absolute whole Unix epoch seconds, never JavaScript milliseconds; a missing or null TTL means no expiration.',
              items: {
                type: 'object',
              },
            },
            runMode: {
              type: 'string',
              description:
                "Run mode for run_column. 'incomplete' (default) re-runs only rows that never produced output or last failed; 'all' re-runs every dep-satisfied row.",
              enum: ['incomplete', 'all'],
            },
            schema: {
              type: 'object',
              description:
                'Table schema with columns array (required for \'create\'). Each column: { name, type, unique? }. Types are string, number, boolean, date, json, select, and ttl. A select (enum) column also takes { options: ["Open", "Closed"], multiple?: true } — options is a list of display names and is required for select. A table may have at most one ttl column; adding it enables row expiration, with cell values stored as absolute whole Unix epoch seconds rather than milliseconds.',
            },
            scope: {
              type: 'string',
              description:
                "Cancellation scope for cancel_table_runs. 'all' cancels in-flight runs across the whole table; 'row' cancels only the row identified by rowId.",
              enum: ['all', 'row'],
            },
            tableId: {
              type: 'string',
              description:
                "Table ID (required for most operations except 'create' and batch 'delete')",
            },
            tableIds: {
              type: 'array',
              description: 'Array of table IDs (for batch delete)',
              items: {
                type: 'string',
              },
            },
            unique: {
              type: 'boolean',
              description: 'Set column unique constraint (optional for update_column)',
            },
            updates: {
              type: 'array',
              description:
                "Array of per-row updates: [{ rowId, data: { col: val } }] (for batch_update_rows). TTL values are absolute whole Unix epoch seconds, never JavaScript milliseconds; omit a row's TTL key to preserve it or set it to null to clear the expiration.",
              items: {
                type: 'object',
                properties: {
                  data: {
                    type: 'object',
                  },
                  rowId: {
                    type: 'string',
                  },
                },
                required: ['rowId', 'data'],
              },
            },
            values: {
              type: 'object',
              description:
                'Map of rowId to value for single-column batch update: { "rowId1": val1, "rowId2": val2 } (for batch_update_rows with columnName). For a TTL column, values are absolute whole Unix epoch seconds, never JavaScript milliseconds; set a row\'s value to null to clear its expiration, and omit the row from the map to leave it unchanged.',
            },
            workflowId: {
              type: 'string',
              description:
                'ID of the workflow (required for add_workflow_group and list_workflow_outputs).',
            },
          },
        },
        operation: {
          type: 'string',
          description: 'The operation to perform',
          enum: [
            'create',
            'create_from_file',
            'import_file',
            'get',
            'get_schema',
            'rename',
            'insert_row',
            'batch_insert_rows',
            'get_row',
            'query_rows',
            'update_row',
            'delete_row',
            'update_rows_by_filter',
            'delete_rows_by_filter',
            'batch_update_rows',
            'batch_delete_rows',
            'add_column',
            'rename_column',
            'delete_column',
            'update_column',
            'add_workflow_group',
            'update_workflow_group',
            'delete_workflow_group',
            'add_workflow_group_output',
            'delete_workflow_group_output',
            'run_column',
            'cancel_table_runs',
            'list_workflow_outputs',
            'list_enrichments',
            'add_enrichment',
          ],
        },
      },
      required: ['operation', 'args'],
    },
    resultSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Operation-specific result payload.',
        },
        message: {
          type: 'string',
          description: 'Human-readable outcome summary.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the operation succeeded.',
        },
      },
      required: ['success', 'message'],
    },
  },
  wait: {
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description:
            'What you are waiting for, in a few words (e.g. "the test suite to finish"). Shown to the user so the pause is not unexplained.',
        },
        seconds: {
          type: 'number',
          description: 'How long to pause, in seconds. Capped at 120.',
        },
      },
      required: ['seconds'],
    },
    resultSchema: undefined,
  },
  wait_agents: {
    parameters: {
      type: 'object',
      properties: {
        agent_ids: {
          type: 'array',
          description: 'The agent ids to wait on, as returned by their async launches.',
          items: {
            type: 'string',
          },
        },
        mode: {
          type: 'string',
          description:
            '"all" (default) wakes when every listed agent finishes; "any" wakes on the first.',
          enum: ['all', 'any'],
        },
        timeout_seconds: {
          type: 'number',
          description:
            'Max seconds to sleep before waking anyway. Default 120, capped at 600. On timeout you get current statuses and can wait again.',
        },
      },
      required: ['agent_ids'],
    },
    resultSchema: undefined,
  },
  web_crawl: {
    parameters: {
      type: 'object',
      properties: {
        exclude_paths: {
          type: 'array',
          description: 'Skip URLs matching these patterns',
          items: {
            type: 'string',
          },
        },
        include_paths: {
          type: 'array',
          description: 'Only crawl URLs matching these patterns',
          items: {
            type: 'string',
          },
        },
        limit: {
          type: 'number',
          description: 'Maximum pages to crawl (default 10, max 50)',
        },
        max_depth: {
          type: 'number',
          description: 'How deep to follow links (default 2)',
        },
        url: {
          type: 'string',
          description: 'Starting URL to crawl from',
        },
      },
      required: ['url'],
    },
    resultSchema: undefined,
  },
  web_fetch: {
    parameters: {
      type: 'object',
      properties: {
        include_highlights: {
          type: 'boolean',
          description: 'Include key highlights (default false)',
        },
        include_summary: {
          type: 'boolean',
          description: 'Include AI-generated summary (default false)',
        },
        include_text: {
          type: 'boolean',
          description: 'Include full page text (default true)',
        },
        urls: {
          type: 'array',
          description: 'URLs to get content from (max 10)',
          items: {
            type: 'string',
          },
        },
      },
      required: ['urls'],
    },
    resultSchema: undefined,
  },
  web_scrape: {
    parameters: {
      type: 'object',
      properties: {
        include_links: {
          type: 'boolean',
          description: 'Extract all links from the page (default false)',
        },
        url: {
          type: 'string',
          description: 'The URL to scrape (must include https://)',
        },
        wait_for: {
          type: 'string',
          description: 'CSS selector to wait for before scraping (for JS-heavy pages)',
        },
      },
      required: ['url'],
    },
    resultSchema: undefined,
  },
  web_search: {
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category',
          enum: [
            'news',
            'tweet',
            'github',
            'company',
            'research paper',
            'linkedin profile',
            'pdf',
            'personal site',
          ],
        },
        include_text: {
          type: 'boolean',
          description: 'Include page text content (default true)',
        },
        num_results: {
          type: 'number',
          description: 'Number of results (default 10, max 25)',
        },
        query: {
          type: 'string',
          description: 'Natural language search query',
        },
        toolTitle: {
          type: 'string',
          description:
            "Required short UI label fragment (e.g. 'Slack integrations'), not a full sentence.",
        },
      },
      required: ['query', 'toolTitle'],
    },
    resultSchema: undefined,
  },
  workflow: {
    parameters: {
      properties: {
        prompt: {
          description:
            'Optional brief instruction (one short sentence) to add scoping that the conversation does not convey. Usually omit it: a new session inherits the current conversation, and a resumed session receives the parent messages it has not yet seen. Do NOT restate or rewrite conversation content.',
          type: 'string',
        },
        sessionId: {
          description:
            'Reusable session ID returned by an earlier workflow call in this chat. Supply it only on a later user message that continues the same task, and at most once per user message — never re-pass a sessionId already used this turn; the agent resumes from its saved transcript and receives unseen parent conversation messages. Omit it for a new or independent task.',
          type: 'string',
        },
        title: {
          description:
            "Required private orchestration label (3–8 words) for this session's stable objective. It is stored in the request-local, chat-scoped Subagent Registry supplied only to the main orchestrator and is not shown to or used as an instruction for the workflow agent. When resuming with sessionId, copy the registry title unchanged.",
          maxLength: 120,
          minLength: 1,
          type: 'string',
        },
      },
      required: ['title'],
      type: 'object',
    },
    resultSchema: undefined,
  },
}
