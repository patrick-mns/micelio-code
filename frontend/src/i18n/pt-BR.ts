// Brazilian Portuguese locale
import type { Translations } from './en';

const ptBR: Translations = {
  // ── App / Layout ─────────────────────────────────────────────────────
  app: {
    sidebarToggle: 'Alternar conversas',
  },
  tabs: {
    chat: 'Chat',
    treemap: 'Mapa',
    usage: 'Uso',
  },

  // ── Header buttons ───────────────────────────────────────────────────
  header: {
    about: 'Sobre o Micelio Code',
    systemPrompt: 'Ver prompt do sistema',
  },

  // ── Window Controls ──────────────────────────────────────────────────
  windowControls: {
    minimize: 'Minimizar',
    maximize: 'Maximizar',
    close: 'Fechar',
  },

  // ── Sidebar ──────────────────────────────────────────────────────────
  sidebar: {
    newSession: 'Nova sessão',
    deleteSession: 'Excluir sessão',
    openSettings: 'Configurações',
    checkUpdates: 'Verificar atualizações',
    scanning: 'Escaneando\u2026',
    openFolder: 'Abrir pasta',
    noFolders: 'Nenhuma pasta ainda \u2014 adicione uma para indexar arquivos.',
    noConversations: 'Nenhuma conversa',
    today: 'Hoje',
    yesterday: 'Ontem',
    thisWeek: 'Esta semana',
    thisMonth: 'Este mês',
    older: 'Mais antigo',
    deleteConfirm: 'Isso excluirá permanentemente esta sessão e seu histórico. Esta ação não pode ser desfeita.',
    deleteTitle: 'Excluir sessão',
    deleteBtn: 'Excluir',
    cancelBtn: 'Cancelar',
  },

  // ── Onboarding ───────────────────────────────────────────────────────
  onboarding: {
    title: 'Bem-vindo ao Micelio Code',
    subtitle: 'Seu assistente de código com IA',
    createFirst: 'Crie seu primeiro workspace',
    desc: 'Um workspace mantém suas próprias pastas, conversas e grafo de conhecimento.',
    openFolder: 'Abrir uma pasta',
    scanHint: 'escaneie um projeto',
    or: 'ou',
    namePlaceholder: 'Nome do workspace vazio',
    createBtn: 'Criar',
    opening: 'Abrindo\u2026',
    step1: 'Abra uma pasta para indexar sua base de código',
    step2: 'Configure seu provedor de IA preferido',
    step3: 'Comece a conversar com seu código',
    cta: 'Começar',
  },

  // ── Settings ─────────────────────────────────────────────────────────
  settings: {
    title: 'Configurações',
    close: 'Fechar',
    appearance: 'Aparência',
    chat: 'Chat',
    providers: 'Provedores',
    workspace: 'Workspace',
    advanced: 'Avançado',
    theme: 'TEMA',
    themeLabel: 'Tema',
    themeDesc: 'Seguir o sistema, ou forçar escuro / claro',
    language: 'IDIOMA',
    languageLabel: 'Idioma',
    languageDesc: 'Escolha o idioma da aplicação',
    accent: 'COR DE DESTAQUE',
    accentLabel: 'Cor de destaque',
    accentDesc: 'Personalize a cor de destaque da aplicação',
    accentDefault: 'Padrão (verde)',
    accentBlue: 'Azul',
    accentPurple: 'Roxo',
    accentOrange: 'Laranja',
    accentPink: 'Rosa',
    accentTeal: 'Ciano',
    accentCustom: 'Personalizada',
    accentCustomHint: 'Escolha qualquer cor',
    themeVariant: 'VARIANTE DE TEMA',
    themeVariantLabel: 'Estilo do tema',
    themeVariantDesc: 'Escolha uma paleta de cores diferente',
    variantDefault: 'Padrão',
    variantSepia: 'Sépia',
    variantHighContrast: 'Alto contraste',
    variantNord: 'Nord',
    variantDracula: 'Drácula',
  },

  // ── ThemeSelect ──────────────────────────────────────────────────────
  theme: {
    system: 'Sistema',
    dark: 'Escuro',
    light: 'Claro',
  },

  // ── About Modal ──────────────────────────────────────────────────────
  about: {
    title: 'Micelio Code',
    close: 'Fechar (Esc)',
    badge: '// experimental',
    description1:
      'Micelio Code é um assistente de programação com IA experimental inspirado no Claude Code. Ele roda localmente via Tauri, suporta múltiplos provedores de modelo (OpenRouter, Anthropic, Ollama) e ajuda você a navegar, editar e raciocinar sobre sua base de código através de uma interface conversacional.',
    description2:
      'Este é um projeto pessoal \u2014 espere arestas, mudanças inesperadas e cogumelos ocasionais. Contribuições e feedback são muito bem-vindos.',
    createdBy: 'Criado por',
  },

  // ── Treemap ──────────────────────────────────────────────────────────
  treemap: {
    title: 'Mapa',
    zoomOut: 'Reduzir zoom',
  },

  // ── Usage ────────────────────────────────────────────────────────────
  usage: {
    title: 'Uso',
    tokens: 'tokens',
    cost: 'custo',
    models: 'Modelos',
    sessions: 'Sessões',
    noData: 'Nenhum dado de uso ainda',
  },

  // ── Chat ─────────────────────────────────────────────────────────────
  chat: {
    placeholder: 'Pergunte algo\u2026',
    send: 'Enviar',
    stop: 'Parar',
    thinking: 'Pensando\u2026',
    noMessages: 'Inicie uma conversa',
    modelSelector: 'Selecione um modelo',
  },

  // ── System Prompt ────────────────────────────────────────────────────
  systemPrompt: {
    title: 'Prompt do Sistema',
    reset: 'Restaurar padrão',
    edit: 'Editar',
    save: 'Salvar',
    close: 'Fechar',
  },

  // ── Update ───────────────────────────────────────────────────────────
  update: {
    available: 'Atualização disponível',
    downloading: 'Baixando\u2026',
    install: 'Instalar e reiniciar',
    close: 'Agora não',
    checkFailed: 'Falha ao verificar atualizações',
    restartLabel: 'Reiniciar para atualizar',
  },

  // ── Review ───────────────────────────────────────────────────────────
  review: {
    title: 'Revisão',
    approve: 'Aprovar',
    reject: 'Rejeitar',
    pending: 'pendente',
    noChanges: 'Nenhuma alteração para revisar',
    filesChanged: 'arquivos modificados',
    workspaceChanges: 'Alterações do workspace',
  },

  // ── Bg Tasks ─────────────────────────────────────────────────────────
  bgTasks: {
    title: 'Tarefas em Segundo Plano',
    empty: 'Nenhuma tarefa em segundo plano',
    taskFinished: 'Tarefa concluída',
    taskFailed: 'Tarefa falhou',
    dismiss: 'Dispensar',
    stop: 'Parar',
    clear: 'Limpar',
    running: 'tarefa em segundo plano',
    runningPlural: 'tarefas em segundo plano executando',
    tasksLabel: 'Tarefas em segundo plano',
  },

  // ── Confirm Modal ────────────────────────────────────────────────────
  confirm: {
    confirm: 'Confirmar',
    cancel: 'Cancelar',
  },

  // ── Scan Overlay ─────────────────────────────────────────────────────
  scan: {
    cancel: 'Cancelar escaneamento',
    scanning: 'Indexando workspace\u2026',
    escHint: '(esc) para cancelar',
  },

  // ── Open in ──────────────────────────────────────────────────────────
  openIn: {
    label: 'Abrir com',
  },
};

export default ptBR;
