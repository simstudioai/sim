/**
 * Inline bootstrap for workspace layout CSS variables (sidebar, panel, terminal).
 *
 * IMPORTANT: Hardcoded values must stay in sync with `stores/constants.ts`.
 * Kept as a plain string so it can be injected outside the React tree via
 * `useServerInsertedHTML` (React 19 rejects `<script>` in component output).
 */
export const WORKSPACE_LAYOUT_DIMENSIONS_SCRIPT = `
(function () {
  try {
    var path = window.location.pathname;
    if (path.indexOf('/workspace/') === -1) {
      return;
    }
  } catch (e) {
    return;
  }

  // Sidebar width. Mirror clampSidebarWidth() in stores/sidebar/store.ts:
  // the upper bound can never fall below the 248px minimum, so a narrow
  // window yields a width >= MIN instead of a sub-minimum sliver.
  var defaultSidebarWidth = 248;
  try {
    // Collapse comes from the cookie (independent of localStorage
    // parsing); the persisted width is read defensively below. Match the
    // value strictly so 'sidebar_collapsed=10' isn't read as collapsed.
    var cookieMatch = document.cookie.match(/(?:^|;\\s*)sidebar_collapsed=([^;]*)/);
    var hasCookie = cookieMatch !== null;
    var collapsed = cookieMatch !== null && cookieMatch[1] === '1';

    var state = null;
    try {
      var stored = localStorage.getItem('sidebar-state');
      state = stored ? JSON.parse(stored).state : null;
    } catch (e) {}

    // One-time migration: seed the cookie from the legacy localStorage
    // flag for users who collapsed before the cookie existed.
    if (!hasCookie && state && typeof state.isCollapsed === 'boolean') {
      collapsed = state.isCollapsed;
      document.cookie = 'sidebar_collapsed=' + (collapsed ? '1' : '0') + '; path=/; max-age=31536000; samesite=lax';
    }

    if (collapsed) {
      document.documentElement.style.setProperty('--sidebar-width', '51px');
    } else {
      var width = state && state.sidebarWidth;
      var maxSidebarWidth = Math.max(248, window.innerWidth * 0.3);
      var finalWidth =
        typeof width === 'number' && isFinite(width)
          ? Math.min(Math.max(width, 248), maxSidebarWidth)
          : defaultSidebarWidth;
      document.documentElement.style.setProperty('--sidebar-width', finalWidth + 'px');
    }
  } catch (e) {
    document.documentElement.style.setProperty('--sidebar-width', defaultSidebarWidth + 'px');
  }

  // Panel width and active tab
  try {
    var panelStored = localStorage.getItem('panel-state');
    if (panelStored) {
      var panelParsed = JSON.parse(panelStored);
      var panelState = panelParsed && panelParsed.state;
      var panelWidth = panelState && panelState.panelWidth;
      var maxPanelWidth = window.innerWidth * 0.4;

      if (panelWidth >= 290 && panelWidth <= maxPanelWidth) {
        document.documentElement.style.setProperty('--panel-width', panelWidth + 'px');
      } else if (panelWidth > maxPanelWidth) {
        document.documentElement.style.setProperty('--panel-width', maxPanelWidth + 'px');
      }

      var activeTab = panelState && panelState.activeTab;
      if (activeTab) {
        document.documentElement.setAttribute('data-panel-active-tab', activeTab);
      }
    }
  } catch (e) {
    // Fallback handled by CSS defaults
  }

  // Editor connections height
  try {
    var editorStored = localStorage.getItem('panel-editor-state');
    if (editorStored) {
      var editorParsed = JSON.parse(editorStored);
      var editorState = editorParsed && editorParsed.state;
      var connectionsHeight = editorState && editorState.connectionsHeight;
      if (connectionsHeight !== undefined && connectionsHeight >= 30 && connectionsHeight <= 300) {
        document.documentElement.style.setProperty(
          '--editor-connections-height',
          connectionsHeight + 'px'
        );
      }
    }
  } catch (e) {
    // Fallback handled by CSS defaults
  }

  // Terminal height
  try {
    var terminalStored = localStorage.getItem('terminal-state');
    if (terminalStored) {
      var terminalParsed = JSON.parse(terminalStored);
      var terminalState = terminalParsed && terminalParsed.state;
      var terminalHeight = terminalState && terminalState.terminalHeight;
      var maxTerminalHeight = window.innerHeight * 0.7;

      if (terminalHeight >= 30 && terminalHeight <= maxTerminalHeight) {
        document.documentElement.style.setProperty('--terminal-height', terminalHeight + 'px');
      } else if (terminalHeight > maxTerminalHeight) {
        document.documentElement.style.setProperty('--terminal-height', maxTerminalHeight + 'px');
      }
    }
  } catch (e) {
    // Fallback handled by CSS defaults
  }
})();
`
