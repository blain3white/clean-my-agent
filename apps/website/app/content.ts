import {
  ArchiveRestore,
  Boxes,
  FileArchive,
  FolderSearch,
  HardDrive,
  KeyRound,
  LifeBuoy,
  LockKeyhole,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'

export const product = {
  name: 'Clean My Agent',
  tagline: 'Your local control center for AI coding-agent data.',
  downloadUrl:
    'https://github.com/blain3white/clean-my-agent/releases/latest/download/Clean-My-Agent-mac-arm64.dmg',
  repoUrl: 'https://github.com/blain3white/clean-my-agent',
}

export const navItems = [
  { href: '/manual', label: 'User Manual' },
  { href: '/scan', label: 'Scan' },
  { href: '/clean', label: 'Clean' },
  { href: '/restore', label: 'Restore' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/export', label: 'Export' },
]

export const supportedAgents = ['Codex', 'Claude Code', 'Cursor', 'Gemini', 'OpenCode']

export const pillars = [
  {
    icon: FolderSearch,
    title: 'Find every session',
    text: 'Scan local agent folders and turn scattered logs, metadata, and project traces into one readable dashboard.',
  },
  {
    icon: ShieldCheck,
    title: 'Clean with a safety net',
    text: 'Review suggestions first, back up risky items, then move files to app-managed Trash instead of deleting them forever.',
  },
  {
    icon: FileArchive,
    title: 'Keep useful history',
    text: 'Back up important sessions and export them as Markdown, JSON, or the universal relay format.',
  },
]

export const quickWorkflow = [
  {
    title: 'Open the app',
    text: 'Clean My Agent starts with a local scan summary. Nothing is cleaned automatically.',
  },
  {
    title: 'Review the scan',
    text: 'Check which agents were found, how much storage they use, and which sessions look old, large, or already backed up.',
  },
  {
    title: 'Choose what to clean',
    text: 'Open Cleanup, inspect each suggestion, and keep anything that still matters.',
  },
  {
    title: 'Back up and move to Trash',
    text: 'For unbacked sessions, create a backup first. Cleanup moves selected files to Clean My Agent Trash.',
  },
  {
    title: 'Restore when needed',
    text: 'If you need something back, restore it from Trash to its original location when possible.',
  },
]

export const manualSections = [
  {
    id: 'what-it-does',
    eyebrow: 'Purpose',
    title: 'What Clean My Agent does',
    icon: Sparkles,
    body: [
      'Clean My Agent is a desktop app for people who use AI coding agents and want local control over the data those tools leave behind.',
      'It helps you see where sessions live, understand which ones are taking space, back up important work, export useful history, and safely clean stale data.',
    ],
    bullets: [
      'See storage and session counts across supported agents.',
      'Inspect sessions before deciding what to keep.',
      'Back up important sessions before risky cleanup.',
      'Export sessions for archiving or relay workflows.',
      'Move cleanup targets to app Trash so recovery stays possible.',
    ],
  },
  {
    id: 'scan',
    eyebrow: 'Scan',
    title: 'How scanning works',
    icon: FolderSearch,
    body: [
      'A scan reads known local storage locations for supported agents and builds a dashboard from files already on your computer.',
      'The scan is read-only. It does not upload data, modify sessions, or remove files.',
    ],
    bullets: [
      'Supported sources: Codex, Claude Code, Cursor, Gemini, and OpenCode.',
      'The dashboard shows session counts, storage use, usage totals, backup status, and cleanup opportunities.',
      'Credential-like files are skipped by design, including .env files, tokens, OAuth data, and API keys.',
    ],
  },
  {
    id: 'cleanup',
    eyebrow: 'Clean',
    title: 'How to clean safely',
    icon: Trash2,
    body: [
      'Cleanup starts with suggestions, not automatic deletion. You stay in control of every action.',
      'Clean My Agent looks for data that is old, unusually large, already backed up, or duplicated in backup folders.',
    ],
    bullets: [
      'Review each cleanup candidate before acting.',
      'Create backups for sessions you might need later.',
      'Move selected items to Clean My Agent Trash instead of permanently deleting them.',
      'Skip anything tied to active work, unresolved tasks, or recent projects.',
    ],
  },
  {
    id: 'restore',
    eyebrow: 'Recover',
    title: 'How restore works',
    icon: ArchiveRestore,
    body: [
      'Items moved by cleanup go into app-managed Trash with enough metadata to help restore them.',
      'When the original path is available, Clean My Agent can put the item back where it came from. If the location changed, use the Trash details to decide where it belongs.',
    ],
    bullets: [
      'Open Trash from the cleanup area.',
      'Choose the item you want back.',
      'Restore it, then rescan to confirm the app sees it again.',
    ],
  },
  {
    id: 'privacy',
    eyebrow: 'Privacy',
    title: 'How privacy is protected',
    icon: LockKeyhole,
    body: [
      'Clean My Agent is local-first. Its core scan, backup, export, cleanup, and restore workflows operate on files on your computer.',
      'The app is built around a simple promise: read first, explain what it found, and ask before changing anything.',
    ],
    bullets: [
      'Session data is not uploaded for scanning or cleanup.',
      'Credential-like files are ignored by scanners.',
      'Backups and exports are written locally where you choose.',
      'Cleanup uses app Trash so you can recover from mistakes.',
    ],
  },
  {
    id: 'export',
    eyebrow: 'Export',
    title: 'How export helps',
    icon: FileArchive,
    body: [
      'Exports let you keep valuable session history outside the original agent storage layout.',
      'Use Markdown for reading, JSON for structured archiving, and universal relay JSON when you want a stable intermediate format.',
    ],
    bullets: [
      'Markdown exports are convenient for human review.',
      'JSON exports preserve more structure for scripts and archives.',
      'Universal relay exports use clean-my-agent.universal-session.v1.',
    ],
  },
]

export const detailPages = {
  scan: {
    eyebrow: 'Scanning',
    title: 'Scan local agent sessions without changing them',
    summary: 'A scan helps you understand what exists before you make cleanup or backup decisions.',
    icon: FolderSearch,
    steps: [
      'Open Clean My Agent and start from the dashboard.',
      'Let the app inspect supported local agent folders.',
      'Review source cards for storage, session counts, token activity, and backup coverage.',
      'Open Sessions to search or inspect individual conversations.',
      'Run another scan after backups, exports, cleanup, or manual file changes.',
    ],
    notes: [
      'Scanning is read-only.',
      'The app skips credential-like files by default.',
      'If an agent is not installed or has no local data, it simply appears empty.',
    ],
  },
  clean: {
    eyebrow: 'Cleaning',
    title: 'Clean stale data with explicit review',
    summary:
      'Cleanup is designed for careful pruning, not surprise deletion. You decide what moves.',
    icon: Trash2,
    steps: [
      'Open the Cleanup view.',
      'Read the reason for each suggestion, such as old session, large log, backed-up item, or duplicate backup.',
      'Keep active work and anything you may need for debugging, compliance, or project memory.',
      'Back up unprotected sessions before selecting them for cleanup.',
      'Move selected items to Clean My Agent Trash.',
    ],
    notes: [
      'Cleanup targets move to app-managed Trash.',
      'Back up before removing data you may want later.',
      'Permanent deletion should happen only after you are confident a Trash item is no longer useful.',
    ],
  },
  restore: {
    eyebrow: 'Recovery',
    title: 'Restore cleaned items from app Trash',
    summary:
      'Trash is the buffer between cleanup and permanent loss. Use it when you need a session or log back.',
    icon: ArchiveRestore,
    steps: [
      'Open the Trash area from Cleanup.',
      'Find the item by agent, path, date, or cleanup reason.',
      'Restore it to the original path when that location still exists.',
      'If the original path is gone, recreate the folder or restore manually using the Trash details.',
      'Run a fresh scan to confirm the restored data appears in the dashboard.',
    ],
    notes: [
      'Restore depends on the original path still being writable.',
      'If another file now exists at the original path, review before overwriting.',
      'Trash is local to Clean My Agent on your machine.',
    ],
  },
  privacy: {
    eyebrow: 'Privacy',
    title: 'Keep agent history on your machine',
    summary:
      'Clean My Agent is built for local inspection and local decisions around sensitive development history.',
    icon: LockKeyhole,
    steps: [
      'Scan local files without uploading session contents.',
      'Skip credential-like files during scanning.',
      'Review cleanup suggestions before anything moves.',
      'Write backups and exports locally.',
      'Restore from local Trash when a cleanup choice needs to be reversed.',
    ],
    notes: [
      'The scanner avoids .env files, tokens, OAuth data, API keys, and similar secrets.',
      'Exports can contain session content, so store them somewhere you trust.',
      'Review exported files before sharing them outside your machine or team.',
    ],
  },
  export: {
    eyebrow: 'Exports',
    title: 'Archive sessions in readable and portable formats',
    summary:
      'Exports give you a way to keep valuable agent work after cleaning or moving source data.',
    icon: FileArchive,
    steps: [
      'Open a session or source you want to preserve.',
      'Choose Markdown for reading, JSON for structured storage, or universal relay JSON for portability.',
      'Pick a local destination you control.',
      'Review the export before sharing it.',
      'Back up important exports with the rest of your project records.',
    ],
    notes: [
      'Universal relay schema: clean-my-agent.universal-session.v1.',
      'Exports are local files.',
      'Exported content may include conversation text and project context.',
    ],
  },
}

export const trustCards = [
  {
    icon: KeyRound,
    title: 'Secrets are skipped',
    text: 'Credential-like files are excluded from scans, including tokens, OAuth data, API keys, and .env files.',
  },
  {
    icon: HardDrive,
    title: 'Local-first workflows',
    text: 'Scanning, cleanup, backup, export, Trash, and restore operate on files on your machine.',
  },
  {
    icon: RefreshCcw,
    title: 'Reversible cleanup',
    text: 'Selected files move to app Trash, giving you a recovery step before permanent deletion.',
  },
  {
    icon: Boxes,
    title: 'Portable archives',
    text: 'Markdown, JSON, and universal relay exports help keep important history outside volatile agent caches.',
  },
]

export const faqItems = [
  {
    q: 'Will Clean My Agent delete files automatically?',
    a: 'No. Cleanup starts with suggestions. You review them, choose what to move, and can back up important sessions first.',
  },
  {
    q: 'Does scanning upload my sessions?',
    a: 'No. The scan reads local files and builds a local dashboard. Backups and exports are local files too.',
  },
  {
    q: 'What should I back up before cleaning?',
    a: 'Back up sessions connected to active projects, recent decisions, debugging history, or anything you may need for audit or handoff.',
  },
  {
    q: 'Can I restore cleaned data?',
    a: 'Yes, cleanup moves files to Clean My Agent Trash. Restore works best when the original location still exists and is writable.',
  },
]

export const supportLinks = [
  { href: product.repoUrl, label: 'GitHub repository' },
  { href: `${product.repoUrl}/issues`, label: 'Report an issue' },
  { href: `${product.repoUrl}/releases/latest`, label: 'Latest release' },
]

export const manualCallouts = [
  {
    icon: LifeBuoy,
    title: 'The simple rule',
    text: 'When in doubt, back up first and clean later. Storage is cheaper than losing a useful development trail.',
  },
  {
    icon: ShieldCheck,
    title: 'The safety model',
    text: 'Read first, suggest cleanup, back up risky items, move to app Trash, restore when needed.',
  },
]
