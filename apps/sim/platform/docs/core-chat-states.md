# Core and Chat: Paper state inventory

These rows inventory the original Paper states. The [current product contract](../AGENTS.md) governs code-first refinements, including icon ink, disclosure behavior and row spacing.

Source: [Platform: Core](https://app.paper.design/file/01M6A91A32GBA6GTN4HASVG0ER) and [Platform: Chat](https://app.paper.design/file/01M6ABW6M1BXJE1J513A6VR6TY). Read back November 4, 2026. This inventories the source examples for this slice; rows and viewport values are references, not breakpoints or a per-screen screenshot certification. Wiki and Workspace product screens are excluded.

## Current Home composition

Home has two inline alignment edges: headings and leading content share the reading-column text edge; the composer, row hover surfaces and outer control bounds extend by the shared 8px row inset. Keep Sim and the Build/Search toggle on the text edges, and align the composer and its loading placeholder with the leftmost recent and Email row on the left and the attention row and menu controls on the right. Measure the 24px dashboard gap between component boxes, including their inline hover overhang. Chart and widget boxes own that inset; the column layout allows for both insets so neighboring surfaces remain 24px apart. Vertical widget gaps use the same 24px as the description-to-Sim gap.

Below the composer, **Recents** shows the website links from the chat panel’s history. Both surfaces use `RecentItems`, its horizontal scroll fade and its per-session dismissal. Home opens a link in a new tab; Chat opens the corresponding resource in its panel. Empty history takes no space.

The first dashboard column contains the activity chart and Email. The second contains Needs your attention and Calendar. On narrow screens the columns stack in that order. Home uses the 24px product-section gap between greeting, composer, recents and widgets, and between dashboard columns and their widgets. The compact 3px heading gap separates greeting from supporting copy, Recents from its links, and the activity title from its total. The Sim heading row stays 12px above its input. Widget content uses the 16px visible gap established by the Email label and first row: measure from the activity total to the chart, attention and Email labels to their row surfaces, and Calendar to the day label. Calendar uses the same 16px gap before its schedule. Header and calendar actions extend around the label line; their hit-area height does not add to these gaps.

The activity chart grows with its content and scrolls only with the page. Lists and the calendar fit within the shared Home height limit, then scroll their content beneath stationary headings without rubber-band overscroll. The expanded notification stack observes the same limit and the available viewport. The Home Workspaces card was retired. Workspaces remain available in the sidebar and chat panel.

Hide Email or Calendar from the widget menu or Customize Home. Email and calendar rows reserve hover for selection. Widget visibility belongs to the section controls. An empty calendar day keeps its scrollable hours. The activity chart’s inspected point uses the line’s opaque color without an outline.

## Current navigation

The shared product layout keeps the main sidebar at the same scroll position when a chat opens or a reader returns from Settings. Closing and reopening the compact drawer also preserves the position. Command K lists Home, Settings and Integrations with their destination icons, followed by text-only workspace and chat results in sidebar order. It uses the same rows and section headings as Platform menus. Integrations opens the [organization integrations routes](organization-integrations.md). Workspace selections open that workspace’s Dashboard in fixture mode and mark its sidebar row current. Pinned workspaces and chats appear first in their respective section and use its current sort order.

## Settings coverage

Core contains 19 Settings specimens in fourteen rows across the two themes. Each shows Preferences, its sidebar, or a state of one of its controls. The central Settings rows accept the actual trailing control: an editable profile picture or name, account email, theme or font picker, or notification switch. At narrow widths a long selector moves below its label. The mobile drawer supports the empty query, matching results, no matches and clear action. Desktop uses the host toolbar.

The sidebar identifies Keyboard shortcuts, Notifications, Connections and the organization destination. The organization menu contract routes Settings to Members. These four destinations reuse the existing Settings sections and rows for the implemented shortcuts, notification controls, connected accounts and member list. Core has no separate screen specimen for those four page bodies. Account, connection and membership values enter through the server fixture gate.

The tables normalize the spacing of canvas annotations that append a viewport description to “Base”. Each of those rows contains one state.

## Platform: Light

| Feature | Paper row | States in reading order |
| --- | --- | --- |
| Home | Base / Web 1440 / Application shell | Base → Base / Collapsed |
| Home | Base / Desktop 1440 / Application shell | Base → Base / Collapsed |
| Home | Base / Web 1920 / Application shell | Base (large monitor, 1920px) |
| Home | Base / Desktop 1920 / Application shell | Base (desktop, 1920px) |
| Home | Actions / Attach open / Web 1440 / Application shell | Attach open → Attach open / Collapsed |
| Home | Actions / Inbox open / Web 1440 / Application shell | Inbox open → Inbox open / Collapsed |
| Home | Actions / Notifications — Expanded stack / Web 1440 / Application shell | Notifications — Expanded stack → Notifications — Expanded stack / Collapsed |
| Home | Connections / Accounts not connected / Web 1440 / Application shell | Accounts not connected → Accounts not connected / Collapsed |
| Home | Connections / Calendar not connected / Web 1440 / Application shell | Calendar not connected → Calendar not connected / Collapsed |
| Home | Connections / Disconnect Calendar / Web 1440 / Application shell | Disconnect Calendar → Disconnect Calendar / Collapsed |
| Home | Connections / Disconnect Email / Web 1440 / Application shell | Disconnect Email → Disconnect Email / Collapsed |
| Home | Connections / Email & Calendar hidden / Web 1440 / Application shell | Email & Calendar hidden → Email & Calendar hidden / Collapsed |
| Home | Connections / Email hidden / Customize open / Web 1440 / Application shell | Email hidden / Customize open → Email hidden / Customize open / Collapsed |
| Home | Connections / Email not connected / Web 1440 / Application shell | Email not connected → Email not connected / Collapsed |
| Home | Connections / No meetings today / Web 1440 / Application shell | No meetings today → No meetings today / Collapsed |
| Home | Dashboard / Chart hover / Web 1440 / Application shell | Chart hover → Chart hover / Collapsed |
| Home | Dashboard / No work yet / Web 1440 / Application shell | No work yet → No work yet / Collapsed |
| Home | Dashboard / Range open / Web 1440 / Application shell | Range open → Range open / Collapsed |
| Home | Dashboard / Tasks run empty / Web 1440 / Application shell | Tasks run empty → Tasks run empty / Collapsed |
| Home | Dashboard / Tasks run hidden / Web 1440 / Application shell | Tasks run hidden → Tasks run hidden / Collapsed |
| Home | Navigation / Help / nested menu / Web 1440 / Application shell | Help / nested menu |
| Home | Navigation / Long lists & attendees hover / Web 1440 / Application shell | Long lists & attendees hover → Long lists & attendees hover / Collapsed |
| Home | Navigation / Sidebar collapsed hover / Web 1440 / Application shell | Sidebar collapsed hover |
| Home | Navigation / Sidebar expanded hover / Web 1440 / Application shell | Sidebar expanded hover |
| Home | Navigation / Sort menu / hover / Web 1440 / Application shell | Sort menu / hover |
| Home | Organization menu / Web 1440 / Application shell | Organization menu open |
| Home | Connections / Accounts not connected / Desktop 1440 / Application shell | Accounts not connected → Accounts not connected / Collapsed |
| Home | Connections / Email & Calendar hidden / Desktop 1440 / Application shell | Email & Calendar hidden → Email & Calendar hidden / Collapsed |
| Home | Organization menu / Desktop 1440 / Application shell | Organization menu open |
| Home | Base / Compact window / Web 1080 / Application shell | Compact window → Compact window / Collapsed |
| Home | Base / Tablet 768 / Application shell | Full page |
| Home | Base / Mobile 390 / Application shell | Full page |
| Home | Base / Mobile 320 / Application shell | Full page |
| Home | Header / Mobile 390 / Application shell | Scrolled glass header |
| Home | Organization menu / Mobile 390 / Mobile sidebar takeover | Organization menu open |
| Settings | Base / Web 1440 / Application shell | Base → Collapsed |
| Settings | Base / Desktop 1440 / Application shell | Base → Collapsed |
| Settings | Base / Web 1920 / Application shell | Base (large monitor, 1920px) |
| Settings | Base / Desktop 1920 / Application shell | Base (desktop, 1920px) |
| Settings | Base / Tablet 768 / Application shell | Base (compact, 768px) |
| Settings | Base / Mobile 390 / Application shell | Full page |
| Settings | Base / Mobile 320 / Application shell | Full page |
| Settings | Navigation / Mobile 390 / Application shell | Settings navigation drawer |
| Settings | Search / Mobile 390 / Application shell | Search / focused → Search / matching result → Search / no results |

## Platform: Dark

| Feature | Paper row | States in reading order |
| --- | --- | --- |
| Home | Base / Web 1440 / Application shell | Expanded → Collapsed |
| Home | Base / Desktop 1440 / Application shell | Expanded |
| Home | Navigation / Organization menu / Open / Web 1440 / Application shell | Organization menu / Open |
| Home | Base / Mobile 390 / Application shell | Home |
| Home | Header / Mobile 390 / Application shell | Scrolled header |
| Home | Navigation / Mobile 390 / Application shell | Organization menu |
| Settings | Base / Web 1440 / Application shell | Preferences |
| Settings | Base / Desktop 1440 / Application shell | Preferences |
| Settings | Navigation / Theme menu / Open / Web 1440 / Application shell | Theme menu / Open |
| Settings | Base / Mobile 390 / Application shell | Preferences |
| Settings | Navigation / Mobile 390 / Application shell | Scrolled header → Settings drawer |

## Chat: Light

| Feature | Paper row | States in reading order |
| --- | --- | --- |
| Conversation | Base / Web 1440 / Conversation | Web / Complete → Web / Base / Collapsed |
| Conversation | Base / Desktop 1440 / Conversation | Desktop / Complete → Desktop / Base / Collapsed |
| Conversation | Base / Web 1920 / Conversation | Large monitor 1920 |
| Conversation | Base / Desktop 1920 / Conversation | Desktop 1920 |
| Conversation | Header overlap / Web 1440 / Conversation | Wide 1440 / Content clears the title / Transparent header |
| Conversation | History / Web 1440 / Conversation | Web / Reading earlier messages |
| Conversation | History / Desktop 1440 / Conversation | Desktop / Reading earlier messages |
| Conversation | Base / Tablet 768 / Native conversation | Compact 768 |
| Conversation | Base / Tablet 768 / Web conversation | Web / Compact 768px |
| Conversation | Header overlap / Tablet 768 / Conversation | Compact 768 / Overlapping content / Full-width glass |
| Conversation | Base / Mobile 390 / Conversation | Mobile 390 |
| Conversation | Base / Mobile 320 / Conversation | Mobile 320 |
| Conversation | Header overlap / Mobile 390 / Conversation | Mobile / Scrolled glass header → Mobile 390 / Overlapping content / Full-width glass |
| Activity and recovery | Execution / Web 1440 / Conversation | Web / Running → Web / Completed activity open → Web / Working disclosure hover → Web / Tool response hover / expanded → Web / Tool failed · retry → Web / Stopped · partial response |
| Activity and recovery | Execution / Desktop 1440 / Conversation | Desktop / Running → Desktop / Tool hover / expanded |
| Messages and attachments | Attachments / Web 1440 / Conversation | Web / Attachments ready → Web / Attachments sent |
| Messages and attachments | Attachment batch / Web 1440 / Conversation | Web / 20 attachments · draft → Web / 20 attachments · sent → Web / 20 attachments · review |
| Messages and attachments | File previews / Web 1440 / Conversation | Web / Image preview → Web / Pasted text preview → Web / PDF preview |
| Messages and attachments | Long prompt / Web 1440 / Conversation | Web / Long prompt collapsed → Web / Long prompt expanded |
| Messages and attachments | Attachment batch / Desktop 1440 / Conversation | Desktop / 20 attachments draft → Desktop / 20 attachments review |
| Messages and attachments | File previews / Desktop 1440 / Conversation | Desktop / PDF preview |
| Messages and attachments | Attachment batch / Mobile 390 / Conversation | Mobile / attachments sent → Mobile / attachments review |
| Feedback | Response actions / Web 1440 / Conversation | Web / Agent · Copy hover → Web / User message · Copy hover → Web / Agent · Rate response hover → Web / Rate response menu → Web / Response feedback |
| Feedback | Response actions / Desktop 1440 / Conversation | Desktop / Rate response menu → Desktop / User message hover |
| Feedback | Response actions / Mobile 390 / Conversation | Mobile / Response feedback |
| Navigation | Drawer / Mobile 390 / Conversation | Mobile / Navigation drawer → Section collapsed / tap → Chat actions / tap → Sort menu / open |
| Panels | Base / Web 1600 / Split panel | Workspaces → Web / File beside chat |
| Panels | Base / Desktop 1600 / Split panel | Launcher → Workspaces → Terminal |
| Panels | Recent history / Web 1600 / Split panel | 0 recents → 1 recent → 2 recents |
| Panels | Recent history / Desktop 1600 / Split panel | 0 recents → 1 recent → 2 recents |
| Panels | Recent history / Desktop 1920 / Split panel | Desktop 1920 / Recent history at the end |
| Panels | Terminal overflow / Desktop 1600 / Split panel | Latest output → Scrollback |
| Panels | Base / Desktop 1600 / Expanded panel | Desktop / Expanded browser → Menu open / Copy link hover → Zoom submenu / 125% hover / 100% selected |
| Panels | Base / Web 1120 / Panel hidden | Web 1120 / Panel hidden |
| Panels | Navigation / Compact 1024 / Split panel | Workspaces |
| Panels | Navigation / Tablet 768 / Single pane | Chat → Workspaces |

## Chat: Dark

| Feature | Paper row | States in reading order |
| --- | --- | --- |
| Conversation | Base / Web 1440 / Conversation | Web / Complete |
| Conversation | Base / Desktop 1440 / Conversation | Desktop / Complete |
| Conversation | Header overlap / Web 1440 / Conversation | Wide 1440 / Content clears the title / Transparent header |
| Conversation | Header overlap / Tablet 768 / Conversation | Compact 768 / Overlapping content / Full-width glass |
| Conversation | Header overlap / Mobile 390 / Conversation | Mobile / Scrolled header → Mobile 390 / Overlapping content / Full-width glass |
| Activity and recovery | Execution / Web 1440 / Conversation | Running / Thinking expanded → Tool response / Expanded → Tool error / Retry |
| Messages and attachments | Attachment batch / Mobile 390 / Conversation | Mobile / 20 attachments |
| Feedback | Response actions / Web 1440 / Conversation | Response feedback |
| Feedback | Response actions / Mobile 390 / Conversation | Mobile / Feedback |
| Panels | Base / Web 1600 / Split panel | Workspaces |
| Panels | Base / Desktop 1600 / Split panel | Launcher → Workspaces → Terminal → Desktop / Browser beside chat |
| Panels | Terminal overflow / Desktop 1600 / Split panel | Latest output → Scrollback |
| Panels | Base / Web 1600 / Expanded panel | Web / Expanded file |
| Panels | Base / Mobile 390 / Panel takeover | Mobile 390 / Panel takeover |
