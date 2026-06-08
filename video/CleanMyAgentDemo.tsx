import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FileText,
  FolderArchive,
  HardDrive,
  LockKeyhole,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'

type Scene = {
  accent: string
  caption: string
  duration: number
  from: number
  kicker: string
  title: string
}

const fps = 30

const scenes: Scene[] = [
  {
    from: 0,
    duration: 4 * fps,
    kicker: 'Pain point',
    title: 'Your AI workspace gets noisy fast.',
    caption:
      'AI coding agents move fast. Their local sessions, logs, caches, and token history pile up even faster.',
    accent: '#ff7a59',
  },
  {
    from: 4 * fps,
    duration: 5 * fps,
    kicker: 'Scan',
    title: 'Scan local agent sessions.',
    caption:
      'Clean My Agent scans your local agent data across Codex, Claude Code, Cursor, Gemini, and OpenCode.',
    accent: '#61d4ff',
  },
  {
    from: 9 * fps,
    duration: 5 * fps,
    kicker: 'Clean',
    title: 'Review cleanup candidates first.',
    caption:
      'It finds stale logs, duplicate backups, and safe cleanup opportunities before anything is moved.',
    accent: '#7ee787',
  },
  {
    from: 14 * fps,
    duration: 5 * fps,
    kicker: 'Restore',
    title: 'Restore from app Trash.',
    caption: 'Need something back? Restore from Clean My Agent Trash in one click.',
    accent: '#ffd166',
  },
  {
    from: 19 * fps,
    duration: 6 * fps,
    kicker: 'Usage',
    title: 'Understand usage by agent and project.',
    caption:
      'The usage dashboard shows where storage and token activity are going, by agent and by project.',
    accent: '#a78bfa',
  },
  {
    from: 25 * fps,
    duration: 5 * fps,
    kicker: 'Privacy',
    title: 'Local-first. Private by default.',
    caption:
      'It stays local-first, ignores credential-like files, and keeps you in control of cleanup.',
    accent: '#4ade80',
  },
]

const agents = ['Codex', 'Claude Code', 'Cursor', 'Gemini', 'OpenCode']

const cleanupRows = [
  ['Stale logs', '1.8 GB', 'Ready'],
  ['Duplicate backups', '640 MB', 'Backed up'],
  ['Old traces', '420 MB', 'Review'],
]

const usageRows = [
  ['Codex', 72, '#61d4ff'],
  ['Claude Code', 58, '#ff7a59'],
  ['Cursor', 44, '#a78bfa'],
  ['Gemini', 33, '#ffd166'],
  ['OpenCode', 24, '#7ee787'],
] as const

export const CleanMyAgentDemo = () => {
  const frame = useCurrentFrame()
  const activeScene = scenes.find(
    (scene) => frame >= scene.from && frame < scene.from + scene.duration,
  )
  const currentScene = activeScene ?? scenes[scenes.length - 1]

  return (
    <AbsoluteFill className="cma-demo">
      <Background />
      <BrandBug />
      <ProgressRail active={currentScene} frame={frame} />
      <Sequence from={0} durationInFrames={120}>
        <PainScene />
      </Sequence>
      <Sequence from={120} durationInFrames={150}>
        <ScanScene />
      </Sequence>
      <Sequence from={270} durationInFrames={150}>
        <CleanupScene />
      </Sequence>
      <Sequence from={420} durationInFrames={150}>
        <RestoreScene />
      </Sequence>
      <Sequence from={570} durationInFrames={180}>
        <UsageScene />
      </Sequence>
      <Sequence from={750} durationInFrames={150}>
        <PrivacyScene />
      </Sequence>
      <Caption scene={currentScene} frame={frame} />
    </AbsoluteFill>
  )
}

const Background = () => {
  const frame = useCurrentFrame()
  const pulse = interpolate(Math.sin(frame / 22), [-1, 1], [0.25, 0.48])

  return (
    <AbsoluteFill>
      <div className="bg-base" />
      <div className="bg-grid" />
      <div className="bg-sheen" style={{ opacity: pulse }} />
    </AbsoluteFill>
  )
}

const BrandBug = () => {
  const frame = useCurrentFrame()
  const entrance = spring({ frame, fps, config: { damping: 22, stiffness: 120 } })

  return (
    <div
      className="brand-bug"
      style={{
        opacity: interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' }),
        transform: `translateY(${interpolate(entrance, [0, 1], [-24, 0])}px)`,
      }}
    >
      <Img src={staticFile('app-logo.png')} className="brand-logo" />
      <span>Clean My Agent</span>
    </div>
  )
}

const ProgressRail = ({ active, frame }: { active: Scene; frame: number }) => {
  return (
    <div className="progress-rail">
      {scenes.map((scene, index) => {
        const isActive = scene === active
        const progress = interpolate(frame, [scene.from, scene.from + scene.duration], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })

        return (
          <div className="rail-step" key={scene.kicker}>
            <div
              className={`rail-dot ${isActive ? 'is-active' : ''}`}
              style={{ borderColor: scene.accent }}
            >
              <div
                className="rail-fill"
                style={{
                  backgroundColor: scene.accent,
                  transform: `scale(${isActive ? Math.max(0.28, progress) : progress > 0 ? 1 : 0})`,
                }}
              />
            </div>
            <span className={isActive ? 'is-active' : ''}>{index + 1}</span>
          </div>
        )
      })}
    </div>
  )
}

const Caption = ({ scene, frame }: { scene: Scene; frame: number }) => {
  const localFrame = frame - scene.from
  const enter = spring({ frame: localFrame, fps, config: { damping: 20, stiffness: 130 } })
  const exit = interpolate(localFrame, [scene.duration - 18, scene.duration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <div
      className="caption"
      style={{
        borderColor: scene.accent,
        opacity: exit,
        transform: `translateY(${interpolate(enter, [0, 1], [26, 0])}px)`,
      }}
    >
      <span style={{ color: scene.accent }}>{scene.kicker}</span>
      <strong>{scene.title}</strong>
      <p>{scene.caption}</p>
    </div>
  )
}

const SceneShell = ({
  eyebrow,
  title,
  children,
}: {
  children: ReactNode
  eyebrow: string
  title: string
}) => {
  const frame = useCurrentFrame()
  const { fps: videoFps } = useVideoConfig()
  const titleIn = spring({ frame, fps: videoFps, config: { damping: 20, stiffness: 110 } })

  return (
    <AbsoluteFill className="scene-shell">
      <div
        className="scene-copy"
        style={{
          opacity: interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' }),
          transform: `translateY(${interpolate(titleIn, [0, 1], [28, 0])}px)`,
        }}
      >
        <span>{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {children}
    </AbsoluteFill>
  )
}

const AppWindow = ({ children, className = '' }: { children: ReactNode; className?: string }) => {
  return (
    <div className={`app-window ${className}`}>
      <div className="window-chrome">
        <i />
        <i />
        <i />
        <span>Clean My Agent</span>
      </div>
      {children}
    </div>
  )
}

const PainScene = () => {
  const frame = useCurrentFrame()
  const scatter = spring({ frame, fps, config: { damping: 18, stiffness: 90 } })

  return (
    <SceneShell eyebrow="Before cleanup" title="Agents leave useful data everywhere.">
      <div className="pain-orbit">
        {['sessions.jsonl', 'tool-traces', 'cache', 'backups', 'tokens', 'logs'].map(
          (label, index) => {
            const rotate = index * 48 - 18
            const distance = interpolate(scatter, [0, 1], [70, 265 + index * 14])

            return (
              <div
                className="floating-file"
                key={label}
                style={{
                  transform: `rotate(${rotate}deg) translateX(${distance}px) rotate(${-rotate}deg)`,
                  opacity: interpolate(frame, [index * 4, 30 + index * 4], [0, 1], {
                    extrapolateRight: 'clamp',
                  }),
                }}
              >
                <FileText size={34} />
                <span>{label}</span>
              </div>
            )
          },
        )}
        <div className="pain-core">
          <HardDrive size={88} />
          <b>Local agent data</b>
          <small>7.4 GB scattered</small>
        </div>
      </div>
    </SceneShell>
  )
}

const ScanScene = () => {
  const frame = useCurrentFrame()
  const sweep = interpolate(frame, [18, 132], [-20, 102], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <SceneShell eyebrow="Step 1" title="Scan every supported agent source.">
      <AppWindow className="scan-window">
        <div className="scan-layout">
          <aside>
            {agents.map((agent, index) => (
              <div
                className="agent-chip"
                key={agent}
                style={{
                  opacity: interpolate(frame, [index * 10, index * 10 + 22], [0, 1], {
                    extrapolateRight: 'clamp',
                  }),
                }}
              >
                <ScanSearch size={28} />
                <span>{agent}</span>
                <CheckCircle2 size={24} />
              </div>
            ))}
          </aside>
          <main className="scan-panel">
            <div className="scan-header">
              <ScanSearch size={38} />
              <div>
                <b>Scanning local sessions</b>
                <small>No cloud upload required</small>
              </div>
            </div>
            <div className="scanner-field">
              <div className="scanner-sweep" style={{ left: `${sweep}%` }} />
              {[0, 1, 2, 3, 4].map((row) => (
                <div className="session-line" key={row}>
                  <span />
                  <i style={{ width: `${68 - row * 7}%` }} />
                </div>
              ))}
            </div>
          </main>
        </div>
      </AppWindow>
    </SceneShell>
  )
}

const CleanupScene = () => {
  const frame = useCurrentFrame()
  const move = interpolate(frame, [58, 124], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <SceneShell eyebrow="Step 2" title="Review before anything moves.">
      <AppWindow className="cleanup-window">
        <div className="metric-row">
          <Metric label="Reclaimable" value="2.86 GB" />
          <Metric label="Backups found" value="18" />
          <Metric label="Risky files" value="0" />
        </div>
        <div className="cleanup-table">
          {cleanupRows.map(([name, size, status], index) => (
            <div
              className="cleanup-row"
              key={name}
              style={{
                opacity: interpolate(frame, [index * 11, index * 11 + 18], [0, 1], {
                  extrapolateRight: 'clamp',
                }),
              }}
            >
              <div>
                <Trash2 size={30} />
                <span>{name}</span>
              </div>
              <b>{size}</b>
              <em>{status}</em>
            </div>
          ))}
        </div>
      </AppWindow>
      <div
        className="trash-drop"
        style={{
          opacity: interpolate(move, [0, 0.2, 1], [0, 1, 1]),
          transform: `translate(${interpolate(move, [0, 1], [-360, 0])}px, ${interpolate(
            move,
            [0, 1],
            [-90, 0],
          )}px)`,
        }}
      >
        <FolderArchive size={52} />
        <span>App Trash</span>
      </div>
    </SceneShell>
  )
}

const RestoreScene = () => {
  const frame = useCurrentFrame()
  const restore = spring({
    frame: Math.max(0, frame - 34),
    fps,
    config: { damping: 20, stiffness: 95 },
  })

  return (
    <SceneShell eyebrow="Step 3" title="Restore mistakes without drama.">
      <div className="restore-lanes">
        <AppWindow className="trash-window">
          <h2>Clean My Agent Trash</h2>
          <div className="restore-card">
            <FolderArchive size={44} />
            <div>
              <b>cursor-session-042</b>
              <small>Moved 2 minutes ago</small>
            </div>
          </div>
        </AppWindow>
        <ArrowRight className="restore-arrow" size={64} />
        <AppWindow className="sessions-window">
          <h2>Sessions</h2>
          <div
            className="restored-card"
            style={{
              opacity: interpolate(restore, [0.15, 0.75], [0, 1]),
              transform: `translateX(${interpolate(restore, [0, 1], [-260, 0])}px)`,
            }}
          >
            <RotateCcw size={42} />
            <div>
              <b>cursor-session-042</b>
              <small>Restored</small>
            </div>
            <CheckCircle2 size={36} />
          </div>
        </AppWindow>
      </div>
    </SceneShell>
  )
}

const UsageScene = () => {
  const frame = useCurrentFrame()

  return (
    <SceneShell eyebrow="Step 4" title="See storage and token usage clearly.">
      <AppWindow className="usage-window">
        <div className="usage-top">
          <Metric label="Sessions" value="184" />
          <Metric label="Tokens" value="12.8M" />
          <Metric label="Projects" value="31" />
        </div>
        <div className="usage-body">
          <div className="bar-chart">
            {usageRows.map(([name, value, color], index) => (
              <div className="bar-row" key={name}>
                <span>{name}</span>
                <div>
                  <i
                    style={{
                      backgroundColor: color,
                      width: `${interpolate(frame, [index * 8 + 10, index * 8 + 55], [0, value], {
                        extrapolateRight: 'clamp',
                      })}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="donut-wrap">
            <div
              className="donut"
              style={{
                background: `conic-gradient(#61d4ff 0 ${interpolate(frame, [20, 90], [0, 38], {
                  extrapolateRight: 'clamp',
                })}%, #ff7a59 0 62%, #a78bfa 0 81%, #7ee787 0)`,
              }}
            >
              <div>
                <BarChart3 size={48} />
                <b>Usage</b>
              </div>
            </div>
          </div>
        </div>
      </AppWindow>
    </SceneShell>
  )
}

const PrivacyScene = () => {
  const frame = useCurrentFrame()
  const shield = spring({ frame, fps, config: { damping: 16, stiffness: 105 } })

  return (
    <SceneShell eyebrow="Always" title="Local-first. Private by default.">
      <div className="privacy-stage">
        <div
          className="privacy-shield"
          style={{
            transform: `scale(${interpolate(shield, [0, 1], [0.72, 1])})`,
          }}
        >
          <ShieldCheck size={132} />
          <b>Clean My Agent</b>
          <small>Your data stays on your machine.</small>
        </div>
        <div className="privacy-list">
          {[
            ['Ignores .env and tokens', <LockKeyhole size={32} key="lock" />],
            ['Moves to app Trash', <Trash2 size={32} key="trash" />],
            ['Read first, clean after review', <Sparkles size={32} key="sparkles" />],
          ].map(([label, icon], index) => (
            <div
              className="privacy-item"
              key={String(label)}
              style={{
                opacity: interpolate(frame, [index * 14 + 18, index * 14 + 38], [0, 1], {
                  extrapolateRight: 'clamp',
                }),
                transform: `translateX(${interpolate(
                  frame,
                  [index * 14 + 18, index * 14 + 38],
                  [36, 0],
                  {
                    extrapolateRight: 'clamp',
                  },
                )}px)`,
              }}
            >
              {icon}
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </SceneShell>
  )
}

const Metric = ({ label, value }: { label: string; value: string }) => {
  return (
    <div className="metric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}
