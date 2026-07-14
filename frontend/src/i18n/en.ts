// English locale — canonical source of truth for all UI strings.
// Every text node visible in the UI should be defined here so other
// locales can provide their own translations.

const en = {
  // ── App / Layout ─────────────────────────────────────────────────────
  app: {
    sidebarToggle: 'Toggle conversations',
    currentSession: 'Current session',
  },
  tabs: {
    chat: 'Chat',
    treemap: 'Treemap',
    usage: 'Usage',
  },

  // ── Header buttons ───────────────────────────────────────────────────
  header: {
    about: 'About Micelio Code',
    systemPrompt: 'View system prompt',
  },

  // ── Window Controls ──────────────────────────────────────────────────
  windowControls: {
    minimize: 'Minimize',
    maximize: 'Maximize',
    close: 'Close',
  },

  // ── Sidebar ──────────────────────────────────────────────────────────
  sidebar: {
    newSession: 'New session',
    deleteSession: 'Delete session',
    openSettings: 'Settings',
    checkUpdates: 'Check for updates',
    scanning: 'Scanning\u2026',
    openFolder: 'Open folder',
    noFolders: 'No folders yet \u2014 add one to index files.',
    noConversations: 'No conversations',
    // Session list
    today: 'Today',
    yesterday: 'Yesterday',
    thisWeek: 'This week',
    thisMonth: 'This month',
    older: 'Older',
    deleteConfirm: 'This will permanently delete this session and its history. This cannot be undone.',
    deleteTitle: 'Delete session',
    deleteBtn: 'Delete',
    cancelBtn: 'Cancel',
  },

  // ── Onboarding ───────────────────────────────────────────────────────
  onboarding: {
    title: 'Welcome to Micelio Code',
    subtitle: 'Your AI coding companion',
    createFirst: 'Create your first workspace',
    desc: 'A workspace holds its own folders, conversations, and knowledge graph.',
    openFolder: 'Open a folder',
    scanHint: 'scan a project',
    or: 'or',
    namePlaceholder: 'Name an empty workspace',
    createBtn: 'Create',
    opening: 'Opening\u2026',
    step1: 'Open a folder to index your codebase',
    step2: 'Configure your preferred AI provider',
    step3: 'Start chatting with your code',
    cta: 'Get started',
  },

  // ── Settings ─────────────────────────────────────────────────────────
  settings: {
    title: 'Settings',
    close: 'Close',
    appearance: 'Appearance',
    chat: 'Chat',
    providers: 'Providers',
    mcp: 'MCP',
    workspace: 'Workspace',
    advanced: 'Advanced',
    // Appearance section
    theme: 'THEME',
    themeLabel: 'Theme',
    themeDesc: 'Follow the system, or force dark / light',
    language: 'LANGUAGE',
    languageLabel: 'Language',
    languageDesc: 'Choose the application language',
    // Accent customization
    accent: 'ACCENT COLOR',
    accentLabel: 'Accent color',
    accentDesc: 'Customize the accent color of the application',
    accentDefault: 'Default (green)',
    accentBlue: 'Blue',
    accentPurple: 'Purple',
    accentOrange: 'Orange',
    accentPink: 'Pink',
    accentTeal: 'Teal',
    // Accent custom
    accentCustom: 'Custom',
    accentCustomHint: 'Pick any color',
    // Theme variants
    themeVariant: 'THEME VARIANT',
    themeVariantLabel: 'Theme style',
    themeVariantDesc: 'Choose a different color palette',
    variantDefault: 'Default',
    variantSepia: 'Sepia',
    variantHighContrast: 'High contrast',
    variantNord: 'Nord',
    variantDracula: 'Dracula',
  },

  // ── ThemeSelect ──────────────────────────────────────────────────────
  theme: {
    system: 'System',
    dark: 'Dark',
    light: 'Light',
  },

  // ── About Modal ──────────────────────────────────────────────────────
  about: {
    title: 'Micelio Code',
    close: 'Close (Esc)',
    badge: '// experimental',
    description1:
      'Micelio Code is an experimental AI coding assistant inspired by Claude Code. It runs locally via Tauri, supports multiple model providers (OpenRouter, Anthropic, Ollama), and helps you navigate, edit, and reason about your codebase through a conversational interface.',
    description2:
      'This is a personal project \u2014 expect rough edges, breaking changes and occasional mushrooms. Contributions and feedback are very welcome.',
    createdBy: 'Created by',
  },

  // ── Treemap ──────────────────────────────────────────────────────────
  treemap: {
    title: 'Treemap',
    zoomOut: 'Zoom out',
  },

  // ── Usage ────────────────────────────────────────────────────────────
  usage: {
    title: 'Usage',
    tokens: 'tokens',
    cost: 'cost',
    models: 'Models',
    sessions: 'Sessions',
    noData: 'No usage data yet',
  },

  // ── Chat ─────────────────────────────────────────────────────────────
  chat: {
    placeholder: 'Ask something\u2026',
    send: 'Send',
    stop: 'Stop',
    thinking: 'Thinking\u2026',
    noMessages: 'Start a conversation',
    modelSelector: 'Select a model',
  },

  // ── System Prompt ────────────────────────────────────────────────────
  systemPrompt: {
    title: 'System Prompt',
    reset: 'Reset to default',
    edit: 'Edit',
    save: 'Save',
    close: 'Close',
  },

  // ── Update ───────────────────────────────────────────────────────────
  update: {
    available: 'Update available',
    downloading: 'Downloading\u2026',
    install: 'Install and restart',
    close: 'Not now',
    checkFailed: 'Failed to check for updates',
    restartLabel: 'Restart to update',
  },

  // ── Review ───────────────────────────────────────────────────────────
  review: {
    title: 'Review',
    approve: 'Approve',
    reject: 'Reject',
    pending: 'pending',
    noChanges: 'No changes to review',
    filesChanged: 'files changed',
    workspaceChanges: 'Workspace changes',
  },

  // ── Bg Tasks ─────────────────────────────────────────────────────────
  bgTasks: {
    title: 'Background Tasks',
    empty: 'No background tasks',
    taskFinished: 'Task finished',
    taskFailed: 'Task failed',
    dismiss: 'Dismiss',
    stop: 'Stop',
    clear: 'Clear',
    running: 'background task',
    runningPlural: 'background tasks running',
    tasksLabel: 'Background tasks',
  },

  // ── Confirm Modal ────────────────────────────────────────────────────
  confirm: {
    confirm: 'Confirm',
    cancel: 'Cancel',
  },

  // ── Scan Overlay ─────────────────────────────────────────────────────
  scan: {
    cancel: 'Cancel scan',
    scanning: 'Indexing workspace\u2026',
    escHint: '(esc) to cancel',
  },

  // ── Open in ──────────────────────────────────────────────────────────
  openIn: {
    label: 'Open in',
  },
};

export default en;
export type Translations = typeof en;
