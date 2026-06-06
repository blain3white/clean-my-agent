import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  FlaskConical,
  ListFilter,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pin,
  RefreshCcw,
  ShieldCheck,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { AgentGlyph } from '@/components/agent-glyph'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  buildCleanupCandidateGroups,
  buildCleanupCategorySummaries,
  cleanupCategoryForCandidate,
  cleanupCompactPath,
  cleanupKindMeta,
  cleanupRiskRank,
  cleanupSourceWeights,
  defaultCleanupSelection,
  type CleanupCandidateGroup,
  type CleanupCategoryKey,
  type CleanupCategorySummary,
  type CleanupFilter,
  type CleanupOrbPhase,
  type CleanupScanStage,
  type CleanupSort,
  type CleanupSourceProgress,
  type CleanupStage,
} from '@/features/cleanup/cleanup-model'
import {
  clearCleanupViewState,
  readCleanupViewState,
  writeCleanupViewState,
} from '@/features/cleanup/cleanup-persistence'
import { playCleanupSystemSound } from '@/features/cleanup/cleanup-system-sound'
import { agentLabel, formatBytes, formatRelative, riskAccent } from '@/lib/format'
import {
  agentSources,
  type AgentSource,
  type CleanupCandidate,
  type DashboardSnapshot,
  type SessionRecord,
} from '@/shared/types'

type CleanupViewProps = {
  cleanup: CleanupCandidate[]
  agents: DashboardSnapshot['agents']
  sessions: SessionRecord[]
  onScanCleanup: () => Promise<CleanupCandidate[]>
  onMoveToTrash: (candidateIds: string[]) => Promise<void>
}

const cleanupOrbMorphTransition = {
  duration: 0.36,
  ease: [0.22, 1, 0.36, 1],
} as const
const cleanupOrbMaxSize = 320
const cleanupOrbMinSize = 248
const cleanupCompleteOrbMinSize = 184
const cleanupCompleteOrbVisualBleed = 72
const cleanupScanningOrbScale = 250 / cleanupOrbMaxSize
const cleanupMaxVisibleGroupSessions = 80

const cleanupBodyTransition = {
  duration: 0.42,
  ease: [0.22, 1, 0.36, 1],
} as const

const cleanupBodyVariants = {
  initial: { opacity: 0, y: 18, filter: 'blur(5px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -14, filter: 'blur(4px)' },
} as const

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function initialCleanupStageSize() {
  if (typeof window === 'undefined') return { width: 960, height: 720 }
  return {
    width: Math.max(640, window.innerWidth - 232),
    height: Math.max(520, window.innerHeight - 64),
  }
}

export function CleanupView({
  cleanup,
  agents,
  sessions,
  onScanCleanup,
  onMoveToTrash,
}: CleanupViewProps) {
  const [persistedState] = useState(() => readCleanupViewState())
  const [stage, setStage] = useState<CleanupStage>(() => persistedState?.stage ?? 'idle')
  const [orbPhase, setOrbPhase] = useState<CleanupOrbPhase>(() =>
    persistedState ? 'finish' : 'initial',
  )
  const [progress, setProgress] = useState(() => (persistedState ? 100 : 0))
  const [localCleanup, setLocalCleanup] = useState<CleanupCandidate[] | null>(null)
  const [selected, setSelected] = useState<string[]>(() =>
    persistedState ? defaultCleanupSelection(cleanup) : [],
  )
  const [filter, setFilter] = useState<CleanupFilter>('all')
  const [sort, setSort] = useState<CleanupSort>('size')
  const [cleaning, setCleaning] = useState(false)
  const [cleaningIds, setCleaningIds] = useState<string[]>([])
  const [cleaned, setCleaned] = useState(false)
  const scanRunRef = useRef(0)
  const visibleCleanup = localCleanup ?? cleanup
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  )

  const sourceTotals = useMemo(
    () =>
      agentSources.reduce(
        (acc, source) => {
          const agent = agents.find((item) => item.source === source)
          const sourceCandidates = visibleCleanup.filter((item) => item.source === source).length
          acc[source] = Math.max(agent?.sessionCount ?? 0, sourceCandidates, 1)
          return acc
        },
        {} as Record<AgentSource, number>,
      ),
    [agents, visibleCleanup],
  )

  const sourceProgress = useMemo<CleanupSourceProgress[]>(
    () =>
      agentSources.map((source) => {
        const weight = cleanupSourceWeights[source]
        const total = sourceTotals[source]
        const localProgress = Math.min(
          1,
          Math.max(0, (progress - weight.start) / (weight.end - weight.start)),
        )
        const scanned = Math.min(total, Math.floor(total * localProgress))
        const status =
          progress >= weight.end ? 'Complete' : progress > weight.start ? 'Scanning' : 'Waiting'
        return { source, scanned, total, status }
      }),
    [progress, sourceTotals],
  )

  const categories = useMemo<CleanupCategorySummary[]>(
    () => buildCleanupCategorySummaries(visibleCleanup),
    [visibleCleanup],
  )

  const totalBytes = useMemo(
    () => visibleCleanup.reduce((total, item) => total + item.sizeBytes, 0),
    [visibleCleanup],
  )

  const filteredCleanup = useMemo(() => {
    const result = visibleCleanup.filter((candidate) => {
      if (filter === 'all') return true
      if (filter === 'recoverable') return candidate.recoverable
      return candidate.risk === filter
    })

    return [...result].sort((a, b) => {
      if (sort === 'risk') return cleanupRiskRank[b.risk] - cleanupRiskRank[a.risk]
      if (sort === 'agent') {
        return agentLabel[a.source ?? 'codex'].localeCompare(agentLabel[b.source ?? 'codex'])
      }
      return b.sizeBytes - a.sizeBytes
    })
  }, [filter, sort, visibleCleanup])

  const selectedBytes = useMemo(
    () =>
      visibleCleanup
        .filter((item) => selected.includes(item.id))
        .reduce((total, item) => total + item.sizeBytes, 0),
    [selected, visibleCleanup],
  )
  const selectedItems = useMemo(
    () => visibleCleanup.filter((item) => selected.includes(item.id)),
    [selected, visibleCleanup],
  )
  const selectedAllVisible =
    filteredCleanup.length > 0 && filteredCleanup.every((item) => selected.includes(item.id))
  const firstSelected = selectedItems[0]

  const beginScan = async () => {
    if (stage === 'scanning') return

    const runId = scanRunRef.current + 1
    scanRunRef.current = runId
    setStage('scanning')
    setOrbPhase('scalein')
    setProgress(0)
    setLocalCleanup(null)
    setCleaned(false)
    setCleaningIds([])
    setSelected([])
    clearCleanupViewState()

    window.setTimeout(() => {
      if (scanRunRef.current === runId) setOrbPhase('running')
    }, 360)

    const startedAt = Date.now()
    const minimumVisualScanMs = 1400
    let scanResult: CleanupCandidate[] | undefined
    let scanError: unknown
    let scanSettled = false
    const scanPromise = onScanCleanup()
      .then((items) => {
        scanResult = items
      })
      .catch((error: unknown) => {
        scanError = error
      })
      .finally(() => {
        scanSettled = true
      })

    await new Promise<void>((resolve) => {
      const timer = window.setInterval(() => {
        if (scanRunRef.current !== runId) {
          window.clearInterval(timer)
          resolve()
          return
        }

        const elapsed = Date.now() - startedAt
        const targetProgress = Math.min(94, Math.floor((elapsed / minimumVisualScanMs) * 94))
        setProgress((current) => {
          return Math.max(current, targetProgress)
        })

        if (elapsed >= minimumVisualScanMs && scanSettled) {
          void scanPromise.then(() => {
            window.clearInterval(timer)
            resolve()
          })
        }
      }, 120)
    })

    if (scanRunRef.current !== runId) return

    if (scanError) {
      console.error(scanError)
      setStage('idle')
      setOrbPhase('initial')
      setProgress(0)
      clearCleanupViewState()
      return
    }

    setLocalCleanup(scanResult ?? [])
    setSelected(defaultCleanupSelection(scanResult ?? []))
    setProgress(100)
    setOrbPhase('scaleout')
    window.setTimeout(() => {
      if (scanRunRef.current !== runId) return
      setStage('complete')
      setOrbPhase('finish')
      writeCleanupViewState(scanResult ?? [])
    }, 360)
  }

  const cancelScan = () => {
    scanRunRef.current += 1
    setStage('idle')
    setOrbPhase('initial')
    setProgress(0)
    clearCleanupViewState()
  }

  const resetCleanupStart = () => {
    scanRunRef.current += 1
    setStage('idle')
    setOrbPhase('initial')
    setProgress(0)
    setLocalCleanup(null)
    setSelected([])
    setCleaningIds([])
    setCleaning(false)
    setCleaned(false)
    clearCleanupViewState()
  }

  const showCleanupSummary = () => {
    setStage('complete')
    setOrbPhase('finish')
    writeCleanupViewState(visibleCleanup)
  }

  const toggleSelected = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  const toggleCategorySelected = (category: CleanupCategoryKey) => {
    const categoryIds = visibleCleanup
      .filter((candidate) => cleanupCategoryForCandidate(candidate) === category)
      .map((candidate) => candidate.id)
    if (categoryIds.length === 0) return

    setSelected((current) => {
      const selectedInCategory = categoryIds.every((id) => current.includes(id))
      if (selectedInCategory) return current.filter((id) => !categoryIds.includes(id))
      return Array.from(new Set([...current, ...categoryIds]))
    })
  }

  const toggleCandidateSetSelected = (ids: string[]) => {
    if (ids.length === 0) return

    setSelected((current) => {
      const allSelected = ids.every((id) => current.includes(id))
      if (allSelected) return current.filter((id) => !ids.includes(id))
      return Array.from(new Set([...current, ...ids]))
    })
  }

  const toggleVisibleSelected = () => {
    const visibleIds = filteredCleanup.map((item) => item.id)
    setSelected((current) => {
      if (selectedAllVisible) return current.filter((id) => !visibleIds.includes(id))
      return Array.from(new Set([...current, ...visibleIds]))
    })
  }

  const moveSelectedToTrash = async () => {
    if (selected.length === 0 || cleaning) return
    playCleanupSystemSound()
    setCleaning(true)
    setCleaned(false)
    setCleaningIds(selected)
    const removing = selected
    try {
      await onMoveToTrash(removing)
      window.setTimeout(() => {
        setLocalCleanup((current) => {
          const next = (current ?? cleanup).filter((item) => !removing.includes(item.id))
          if (stage === 'complete' || stage === 'review') writeCleanupViewState(next)
          return next
        })
        setSelected([])
        setCleaningIds([])
        setCleaning(false)
        setCleaned(true)
        playCleanupSystemSound()
        window.setTimeout(() => setCleaned(false), 1500)
      }, 520)
    } catch (error) {
      console.error(error)
      setCleaningIds([])
      setCleaning(false)
    }
  }

  const reviewPanel = (
    <div className="cleanup-review-grid grid h-full min-h-0 grid-cols-[minmax(0,1fr)_332px] gap-5 max-[1180px]:grid-cols-1">
      <Card className="glass-panel flex min-h-0 overflow-hidden rounded-lg py-0">
        <CardHeader className="flex-row items-center justify-between gap-4 px-7 pb-0 pt-6">
          <div className="min-w-0">
            <CardTitle className="text-[20px] font-semibold text-white">
              Cleanup candidates
            </CardTitle>
            <p className="mt-2 text-sm text-white/52">
              Review local sessions before moving anything to app Trash.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="lg"
              onClick={toggleVisibleSelected}
              className="h-9 rounded-lg border-white/12 bg-white/5 px-3 text-[13px] font-normal text-white/76 hover:bg-white/10"
            >
              <CheckCircle2 className="size-4" />
              {selectedAllVisible ? 'Deselect visible' : 'Select visible'}
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={resetCleanupStart}
              className="h-9 rounded-lg border-white/12 bg-white/5 px-3 text-[13px] font-normal text-white/76 hover:bg-white/10"
            >
              <RefreshCcw className="size-4" />
              Scan again
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.035] p-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {(
                [
                  ['all', 'All'],
                  ['high', 'High'],
                  ['medium', 'Medium'],
                  ['low', 'Low'],
                  ['recoverable', 'Recoverable'],
                ] satisfies Array<[CleanupFilter, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`h-8 rounded-md px-3 text-xs transition ${
                    filter === value
                      ? 'bg-emerald-400/16 text-emerald-200 ring-1 ring-emerald-300/24'
                      : 'text-white/52 hover:bg-white/8 hover:text-white/78'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-white/44">
              <ListFilter className="size-4" />
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as CleanupSort)}
                className="h-8 rounded-md border border-white/10 bg-black/18 px-2 text-xs text-white/76 outline-none"
              >
                <option value="size">Sort: Size</option>
                <option value="risk">Sort: Risk</option>
                <option value="agent">Sort: Agent</option>
              </select>
            </label>
          </div>

          <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-auto pr-1">
            {filteredCleanup.length === 0 ? (
              <div className="grid min-h-[260px] place-items-center rounded-lg border border-white/8 bg-white/[0.03] text-center">
                <div>
                  <CheckCircle2 className="mx-auto size-10 text-emerald-300" />
                  <div className="mt-3 text-sm font-medium text-white">No candidates here</div>
                  <div className="mt-1 text-xs text-white/42">
                    Try another filter or scan again.
                  </div>
                </div>
              </div>
            ) : (
              filteredCleanup.map((candidate, index) => (
                <CleanupCandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  checked={selected.includes(candidate.id)}
                  cleaning={cleaningIds.includes(candidate.id)}
                  index={index}
                  onToggle={() => toggleSelected(candidate.id)}
                />
              ))
            )}
          </div>

          <div className="mt-5 flex shrink-0 items-center justify-between border-t border-white/8 px-1 pt-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 text-emerald-300" />
              <div>
                <div className="text-sm font-medium text-white">
                  {selected.length} candidate{selected.length === 1 ? '' : 's'} selected
                </div>
                <div className="mt-1 text-xs text-white/45">
                  {formatBytes(selectedBytes)} recoverable after backup and Trash move.
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="lg"
              onClick={showCleanupSummary}
              className="h-9 rounded-lg border-white/12 bg-white/5 px-4 text-[13px] font-normal text-white/72 hover:bg-white/10 hover:text-white"
            >
              Summary
            </Button>
          </div>
        </CardContent>
      </Card>

      <CleanupQueuePanel
        selectedItems={selectedItems}
        selectedBytes={selectedBytes}
        firstSelected={firstSelected}
        cleaning={cleaning}
        cleaned={cleaned}
        onMoveToTrash={() => void moveSelectedToTrash()}
        onClear={() => setSelected([])}
      />
    </div>
  )

  return (
    <CleanupScanShell
      stage={stage}
      orbPhase={orbPhase}
      progress={progress}
      sourceProgress={sourceProgress}
      totalBytes={totalBytes}
      categories={categories}
      candidates={visibleCleanup}
      sessionById={sessionById}
      selected={selected}
      cleaning={cleaning}
      cleaned={cleaned}
      cleaningIds={cleaningIds}
      onStart={() => void beginScan()}
      onCancel={cancelScan}
      onScanAgain={resetCleanupStart}
      onClean={() => void moveSelectedToTrash()}
      onToggleCandidate={toggleSelected}
      onToggleCandidates={toggleCandidateSetSelected}
      onToggleCategory={toggleCategorySelected}
      reviewPanel={reviewPanel}
    />
  )
}

function CleanupScanShell({
  stage,
  orbPhase,
  progress,
  sourceProgress,
  totalBytes,
  categories,
  candidates,
  sessionById,
  selected,
  cleaning,
  cleaned,
  cleaningIds,
  onStart,
  onCancel,
  onScanAgain,
  onClean,
  onToggleCandidate,
  onToggleCandidates,
  onToggleCategory,
  reviewPanel,
}: {
  stage: CleanupStage
  orbPhase: CleanupOrbPhase
  progress: number
  sourceProgress: CleanupSourceProgress[]
  totalBytes: number
  categories: CleanupCategorySummary[]
  candidates: CleanupCandidate[]
  sessionById: Map<string, SessionRecord>
  selected: string[]
  cleaning: boolean
  cleaned: boolean
  cleaningIds: string[]
  onStart: () => void
  onCancel: () => void
  onScanAgain: () => void
  onClean: () => void
  onToggleCandidate: (id: string) => void
  onToggleCandidates: (ids: string[]) => void
  onToggleCategory: (category: CleanupCategoryKey) => void
  reviewPanel: ReactNode
}) {
  const orbMode: CleanupScanStage = stage === 'review' ? 'complete' : stage
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState(initialCleanupStageSize)

  useEffect(() => {
    const node = stageRef.current
    if (!node) return

    const updateSize = () => {
      const rect = node.getBoundingClientRect()
      setStageSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      })
    }

    updateSize()
    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(node)
    return () => resizeObserver.disconnect()
  }, [])

  const orbSize = clampNumber(stageSize.height * 0.42, cleanupOrbMinSize, cleanupOrbMaxSize)
  const idleTop = clampNumber(
    stageSize.height * 0.5 - orbSize / 2 - 54,
    48,
    Math.max(48, stageSize.height - orbSize - 124),
  )
  const completeOrbSize = clampNumber(
    Math.min(stageSize.height * 0.31, stageSize.width * 0.23),
    cleanupCompleteOrbMinSize,
    cleanupOrbMaxSize,
  )
  const scanningOrbSize = clampNumber(
    Math.min(stageSize.height * 0.36, stageSize.width * 0.34),
    220,
    300,
  )
  const activeOrbSize =
    stage === 'complete' ? completeOrbSize : stage === 'scanning' ? scanningOrbSize : orbSize
  const completeGutter = clampNumber(stageSize.width * 0.028, 18, 64)
  const completeSideSpace = clampNumber(
    completeOrbSize + completeGutter + cleanupCompleteOrbVisualBleed + 24,
    360,
    Math.min(560, stageSize.width * 0.42),
  )
  const scanBodyWidth = Math.min(
    Math.max(320, stageSize.width - 36),
    clampNumber(stageSize.width * 0.62, 480, 620),
  )
  const scanStackGap = clampNumber(stageSize.height * 0.026, 14, 24)
  const estimatedScanBodyHeight = stageSize.height < 640 ? 230 : stageSize.height < 720 ? 270 : 300
  const scanStackHeight = scanningOrbSize + scanStackGap + estimatedScanBodyHeight
  const scanOrbTop = clampNumber(
    (stageSize.height - scanStackHeight) / 2,
    24,
    Math.max(24, stageSize.height - scanStackHeight - 20),
  )
  const scanOrbLeft = stageSize.width / 2 - scanningOrbSize / 2
  const scanContentTop = scanOrbTop + scanningOrbSize + scanStackGap
  const scanContentLeft = stageSize.width / 2 - scanBodyWidth / 2
  const idleContentTop = clampNumber(
    idleTop + orbSize + clampNumber(stageSize.height * 0.026, 22, 38),
    0,
    Math.max(0, stageSize.height - 188),
  )
  const orbTop =
    stage === 'idle'
      ? idleTop
      : stage === 'complete'
        ? clampNumber(stageSize.height * 0.074, 54, 112)
        : scanOrbTop
  const orbLeft =
    stage === 'complete'
      ? Math.max(
          completeGutter,
          stageSize.width -
            completeGutter -
            completeSideSpace +
            (completeSideSpace - activeOrbSize) / 2,
        )
      : stage === 'scanning'
        ? scanOrbLeft
        : stageSize.width / 2 - activeOrbSize / 2
  const stageStyle = {
    '--cleanup-idle-content-top': `${idleContentTop}px`,
    '--cleanup-result-gutter': `${completeGutter}px`,
    '--cleanup-result-orb-size': `${activeOrbSize}px`,
    '--cleanup-result-orb-top': `${orbTop}px`,
    '--cleanup-result-side-space': `${completeSideSpace}px`,
    '--cleanup-scan-content-left': `${scanContentLeft}px`,
    '--cleanup-scan-content-top': `${scanContentTop}px`,
    '--cleanup-scan-content-width': `${scanBodyWidth}px`,
  } as CSSProperties
  const orbProps =
    orbMode === 'idle'
      ? {
          mode: 'idle' as const,
          phase: orbPhase,
          progress: 0,
          icon: <Search className="size-16" />,
          title: 'Start Scan',
          onClick: onStart,
        }
      : orbMode === 'scanning'
        ? {
            mode: 'scanning' as const,
            phase: orbPhase,
            progress,
            title: 'Scanning...',
          }
        : {
            mode: 'complete' as const,
            phase: orbPhase,
            progress: 100,
            icon: <CheckCircle2 className="size-12" />,
            title: formatBytes(totalBytes),
            detail: totalBytes > 0 ? 'Ready to clean' : 'Nothing to clean',
          }

  return (
    <div ref={stageRef} className={`cleanup-stage cleanup-stage-${stage}`} style={stageStyle}>
      <motion.div
        className={`cleanup-orb-layer cleanup-orb-layer-${stage}`}
        initial={false}
        animate={{
          x: orbLeft,
          y: orbTop,
          width: activeOrbSize,
          height: activeOrbSize,
          opacity: stage === 'review' ? 0 : 1,
        }}
        transition={cleanupOrbMorphTransition}
      >
        <CleanupOrbButton {...orbProps} size={activeOrbSize} />
      </motion.div>
      <div className="cleanup-view-layer cleanup-idle-layer">
        <AnimatePresence>
          {stage === 'idle' && (
            <motion.div
              key="idle"
              className="cleanup-stage-body cleanup-stage-body-idle"
              variants={cleanupBodyVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={cleanupBodyTransition}
            >
              <CleanupIdleBody />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="cleanup-view-layer cleanup-scanning-layer">
        <AnimatePresence>
          {stage === 'scanning' && (
            <motion.div
              key="scanning"
              className="cleanup-stage-body cleanup-stage-body-scanning"
              variants={cleanupBodyVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={cleanupBodyTransition}
            >
              <CleanupScanningBody sourceProgress={sourceProgress} onCancel={onCancel} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="cleanup-view-layer cleanup-complete-layer">
        <AnimatePresence>
          {stage === 'complete' && (
            <motion.div
              key="complete"
              className="cleanup-stage-body cleanup-stage-body-complete h-full min-h-0"
              variants={cleanupBodyVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={cleanupBodyTransition}
            >
              <CleanupCompleteBody
                categories={categories}
                candidates={candidates}
                sessionById={sessionById}
                selected={selected}
                cleaning={cleaning}
                cleaned={cleaned}
                cleaningIds={cleaningIds}
                onClean={onClean}
                onScanAgain={onScanAgain}
                onToggleCandidate={onToggleCandidate}
                onToggleCandidates={onToggleCandidates}
                onToggleCategory={onToggleCategory}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="cleanup-view-layer cleanup-review-layer">
        <AnimatePresence>
          {stage === 'review' && (
            <motion.div
              key="review"
              className="cleanup-stage-body cleanup-stage-body-review h-full min-h-0"
              variants={cleanupBodyVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={cleanupBodyTransition}
            >
              {reviewPanel}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <CleanupSafetyNote
        className="cleanup-safety-bottom"
        text={
          stage === 'complete' || stage === 'review'
            ? 'All session data was analyzed locally.'
            : 'All session data is analyzed locally.'
        }
      />
    </div>
  )
}

function CleanupIdleBody() {
  return (
    <>
      <div className="cleanup-scan-title text-center text-[14px] text-white/58">
        Scan large chats, inactive chats, and test chats.
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-2 [@media(max-height:760px)]:mt-3">
        <CleanupPill icon={<MessageSquare className="size-4" />} label="Large chats" />
        <CleanupPill icon={<Clock className="size-4" />} label="90 days inactive" />
        <CleanupPill icon={<FlaskConical className="size-4" />} label="Test chats" />
      </div>
    </>
  )
}

function CleanupScanningBody({
  sourceProgress,
  onCancel,
}: {
  sourceProgress: CleanupSourceProgress[]
  onCancel: () => void
}) {
  return (
    <>
      <div className="text-center text-[14px] text-white/58">
        Analyzing session size, inactivity, and test chats
      </div>
      <Card className="cleanup-scan-card mx-auto mt-3.5 w-full max-w-[600px] rounded-lg py-0 [@media(max-height:760px)]:mt-3">
        <CardContent className="px-3.5 py-3">
          <div className="space-y-2.5">
            {sourceProgress.map((item) => (
              <CleanupSourceRow key={item.source} item={item} />
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="cleanup-scan-actions mt-3.5 flex items-center justify-center [@media(max-height:760px)]:mt-3">
        <Button
          variant="outline"
          size="lg"
          onClick={onCancel}
          className="cleanup-action-button h-9 rounded-lg border-white/14 bg-white/5 px-5 text-[13px] text-white/84 hover:bg-white/10"
        >
          Cancel
        </Button>
      </div>
    </>
  )
}

function CleanupCompleteBody({
  categories,
  candidates,
  sessionById,
  selected,
  cleaning,
  cleaned,
  cleaningIds,
  onClean,
  onScanAgain,
  onToggleCandidate,
  onToggleCandidates,
  onToggleCategory,
}: {
  categories: CleanupCategorySummary[]
  candidates: CleanupCandidate[]
  sessionById: Map<string, SessionRecord>
  selected: string[]
  cleaning: boolean
  cleaned: boolean
  cleaningIds: string[]
  onClean: () => void
  onScanAgain: () => void
  onToggleCandidate: (id: string) => void
  onToggleCandidates: (ids: string[]) => void
  onToggleCategory: (category: CleanupCategoryKey) => void
}) {
  const [expandedCategory, setExpandedCategory] = useState<CleanupCategoryKey | null>('inactive')
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)
  const candidatesByCategory = useMemo(() => {
    const grouped: Record<CleanupCategoryKey, CleanupCandidate[]> = {
      large: [],
      inactive: [],
      test: [],
    }

    for (const candidate of candidates) {
      grouped[cleanupCategoryForCandidate(candidate)].push(candidate)
    }

    return grouped
  }, [candidates])
  const groupsByCategory = useMemo(
    () => ({
      large: buildCleanupCandidateGroups(candidatesByCategory.large, sessionById),
      inactive: buildCleanupCandidateGroups(candidatesByCategory.inactive, sessionById),
      test: buildCleanupCandidateGroups(candidatesByCategory.test, sessionById),
    }),
    [candidatesByCategory, sessionById],
  )
  const selectedCount = candidates.filter((candidate) => selected.includes(candidate.id)).length
  const selectedBytes = candidates
    .filter((candidate) => selected.includes(candidate.id))
    .reduce((total, candidate) => total + candidate.sizeBytes, 0)

  return (
    <div className="cleanup-complete-layout">
      <div className="cleanup-complete-list">
        <div className="cleanup-complete-description text-[14px] text-white/58">
          Large chats, inactive chats, and test chats were found locally.
        </div>
        <div className="cleanup-result-accordion mt-4">
          {categories.map((category) => (
            <CleanupCategoryRow
              key={category.key}
              category={category}
              candidates={candidatesByCategory[category.key]}
              groups={groupsByCategory[category.key]}
              expanded={expandedCategory === category.key}
              expandedGroupId={expandedGroupId}
              selected={selected}
              cleaningIds={cleaningIds}
              onToggleExpanded={() => {
                setExpandedCategory((current) => (current === category.key ? null : category.key))
                setExpandedGroupId(null)
              }}
              onToggleCategory={() => onToggleCategory(category.key)}
              onToggleCandidate={onToggleCandidate}
              onToggleCandidates={onToggleCandidates}
              onToggleGroup={(groupId) =>
                setExpandedGroupId((current) => (current === groupId ? null : groupId))
              }
            />
          ))}
        </div>
      </div>
      <div className="cleanup-result-actions">
        <div className={`cleanup-result-selection ${cleaned ? 'is-cleaned' : ''}`}>
          <AnimatePresence mode="wait">
            <motion.span
              key={cleaned ? 'cleaned' : 'selected'}
              className="cleanup-result-selection-inner"
              initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {cleaned ? (
                <>
                  <CheckCircle2 className="size-4 text-emerald-300" />
                  <span>Moved to Trash. Backup retained.</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="size-4 text-emerald-300" />
                  <span>
                    {selectedCount} selected / {formatBytes(selectedBytes)}
                  </span>
                </>
              )}
            </motion.span>
          </AnimatePresence>
        </div>
        <Button
          onClick={onClean}
          disabled={selectedCount === 0 && !cleaned}
          aria-disabled={cleaning || (selectedCount === 0 && !cleaned)}
          className={`cleanup-primary-action cleanup-clean-button h-10 rounded-lg bg-emerald-400 text-[13px] font-semibold text-emerald-950 shadow-[0_18px_38px_rgb(52_211_153_/_26%)] hover:bg-emerald-300 disabled:pointer-events-none disabled:brightness-75 disabled:saturate-50 ${
            cleaning ? 'is-cleaning' : ''
          } ${cleaned ? 'is-cleaned' : ''}`}
        >
          {cleaned && (
            <span className="cleanup-clean-button-burst" aria-hidden>
              {Array.from({ length: 8 }).map((_, index) => (
                <span key={index} />
              ))}
            </span>
          )}
          <span className="cleanup-clean-button-content">
            {cleaning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : cleaned ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {cleaning ? 'Cleaning...' : cleaned ? 'Cleaned' : 'Clean'}
          </span>
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={onScanAgain}
          className="cleanup-action-button cleanup-secondary-action h-10 rounded-lg border-white/14 bg-white/5 text-[13px] text-white/84 hover:bg-white/10"
        >
          <RefreshCcw className="size-4" />
          Scan Again
        </Button>
      </div>
    </div>
  )
}

function CleanupOrbButton({
  mode,
  phase,
  progress,
  size,
  icon,
  title,
  detail,
  onClick,
}: {
  mode: 'idle' | 'scanning' | 'complete'
  phase: CleanupOrbPhase
  progress: number
  size: number
  icon?: ReactNode
  title: string
  detail?: string
  onClick?: () => void
}) {
  const visualScale = mode === 'scanning' ? cleanupScanningOrbScale : 1
  const textScale = size / cleanupOrbMaxSize
  const stroke = mode === 'scanning' ? 10 : 7
  const radius = size / 2 - stroke * 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (progress / 100) * circumference
  const displayParts = title.split(' ')
  const roundedProgress = Math.round(progress)

  const content =
    mode === 'scanning' ? (
      <>
        <span className="cleanup-orb-percent">{roundedProgress}</span>
        <span className="cleanup-orb-status">{title}</span>
      </>
    ) : mode === 'complete' ? (
      <>
        <span className="cleanup-orb-check">
          <Check className="size-8" />
        </span>
        <span className="cleanup-orb-size">
          <span>{displayParts[0]}</span>
          <small>{displayParts.slice(1).join(' ')}</small>
        </span>
        {detail && <span className="cleanup-orb-ready">{detail}</span>}
      </>
    ) : (
      <>
        <span className="cleanup-orb-icon">{icon}</span>
        <span className="cleanup-orb-label">{title}</span>
      </>
    )

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`cleanup-orb cleanup-orb-${mode}`}
      aria-label={onClick ? title : undefined}
      initial={false}
      animate={{
        width: size,
        height: size,
        opacity: 1,
      }}
      whileHover={onClick ? { scale: 1.012 } : undefined}
      whileTap={onClick ? { scale: 0.985 } : undefined}
      transition={cleanupOrbMorphTransition}
      data-phase={phase}
      style={{ '--cleanup-orb-scale': textScale } as CSSProperties}
    >
      <motion.span
        className={`cleanup-orb-visual cleanup-orb-visual-${mode}`}
        initial={false}
        animate={{ scale: visualScale }}
        transition={cleanupOrbMorphTransition}
        data-phase={phase}
      >
        <span className="cleanup-orb-particles" />
        <svg
          className="cleanup-orb-ring"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
        >
          <circle
            className="cleanup-orb-track"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
          />
          <circle
            className="cleanup-orb-progress"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={mode === 'idle' ? 0 : dashOffset}
          />
        </svg>
        <motion.span
          key={mode}
          className={`cleanup-orb-content cleanup-orb-content-${mode}`}
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          {content}
        </motion.span>
      </motion.span>
    </motion.button>
  )
}

function CleanupPill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex h-9 min-w-[136px] items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3.5 text-[12px] text-white/72 shadow-[inset_0_1px_0_rgb(255_255_255_/_6%)]">
      <span className="text-emerald-300">{icon}</span>
      {label}
    </div>
  )
}

function CleanupSafetyNote({ className, text }: { className?: string; text: string }) {
  return (
    <div
      className={`flex items-center justify-center gap-3 text-sm text-white/43 ${className ?? ''}`}
    >
      <ShieldCheck className="size-4 text-white/38" />
      {text}
    </div>
  )
}

function CleanupSourceRow({ item }: { item: CleanupSourceProgress }) {
  const percent =
    item.total === 0 ? 0 : Math.min(100, Math.round((item.scanned / item.total) * 100))
  const StatusIcon =
    item.status === 'Complete' ? CheckCircle2 : item.status === 'Scanning' ? Loader2 : Clock

  return (
    <div className="cleanup-source-row grid grid-cols-[132px_minmax(0,1fr)_64px_80px] items-center gap-2.5 max-[980px]:grid-cols-[124px_minmax(0,1fr)_58px_76px]">
      <div className="flex min-w-0 items-center gap-2.5">
        <AgentGlyph source={item.source} />
        <span className="truncate text-[13px] font-medium text-white/82">
          {agentLabel[item.source]}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-emerald-300 transition-[width] duration-500 ease-out shadow-[0_0_14px_rgb(52_211_153_/_55%)]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="text-right text-xs tabular-nums text-white/58">
        {item.scanned} / {item.total}
      </div>
      <div className="flex items-center gap-2 text-xs text-white/50">
        <StatusIcon
          className={`size-4 ${
            item.status === 'Complete'
              ? 'text-emerald-300'
              : item.status === 'Scanning'
                ? 'animate-spin text-emerald-300'
                : 'text-white/38'
          }`}
        />
        {item.status}
      </div>
    </div>
  )
}

function CleanupCategoryRow({
  category,
  candidates,
  groups,
  expanded,
  expandedGroupId,
  selected,
  cleaningIds,
  onToggleExpanded,
  onToggleCategory,
  onToggleCandidate,
  onToggleCandidates,
  onToggleGroup,
}: {
  category: CleanupCategorySummary
  candidates: CleanupCandidate[]
  groups: CleanupCandidateGroup[]
  expanded: boolean
  expandedGroupId: string | null
  selected: string[]
  cleaningIds: string[]
  onToggleExpanded: () => void
  onToggleCategory: () => void
  onToggleCandidate: (id: string) => void
  onToggleCandidates: (ids: string[]) => void
  onToggleGroup: (groupId: string) => void
}) {
  const Icon = category.icon
  const ActionIcon =
    category.action === 'Recommended' ? Sparkles : category.action === 'Review' ? Eye : ShieldCheck
  const selectedInCategory = candidates.filter((candidate) => selected.includes(candidate.id))
  const allSelected = candidates.length > 0 && selectedInCategory.length === candidates.length
  const someSelected = selectedInCategory.length > 0 && !allSelected
  const accentClass =
    category.key === 'large'
      ? 'cleanup-category-accent-green'
      : category.key === 'inactive'
        ? 'cleanup-category-accent-blue'
        : 'cleanup-category-accent-violet'
  const tagClass =
    category.action === 'Recommended'
      ? 'cleanup-category-tag-green'
      : category.action === 'Review'
        ? 'cleanup-category-tag-blue'
        : 'cleanup-category-tag-neutral'

  return (
    <div className={`cleanup-category-row ${expanded ? 'is-expanded' : ''}`}>
      <button
        type="button"
        onClick={onToggleExpanded}
        className="cleanup-category-trigger"
        aria-expanded={expanded}
      >
        <span className={`cleanup-category-icon ${accentClass}`}>
          <Icon className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-[14px] font-semibold text-white">
            {category.title}
            <span className="cleanup-category-count">{category.count}</span>
          </span>
          <span className="mt-1 block truncate text-[12px] text-white/52">
            {category.description}
          </span>
        </span>
        <Badge variant="outline" className={`cleanup-category-tag ${tagClass}`}>
          <ActionIcon className="size-3.5" />
          {category.action}
        </Badge>
        <span className="text-right text-[14px] font-semibold text-white">
          {formatBytes(category.bytes)}
        </span>
        <ChevronDown
          className={`cleanup-category-chevron size-4 text-white/64 ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="cleanup-category-details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <div className="cleanup-group-list">
              <div className="cleanup-group-header">
                <button
                  type="button"
                  onClick={onToggleCategory}
                  className={`cleanup-check ${allSelected ? 'is-checked' : ''} ${
                    someSelected ? 'is-mixed' : ''
                  }`}
                  aria-label={`${allSelected ? 'Deselect' : 'Select'} ${category.title}`}
                >
                  {allSelected ? <Check className="size-3.5" /> : someSelected ? '–' : null}
                </button>
                <span>Group</span>
                <span>Agent</span>
                <span>Sessions</span>
                <span>Last opened</span>
                <span>Size</span>
                <span />
              </div>

              {groups.map((group) => (
                <CleanupCandidateGroupRow
                  key={group.id}
                  group={group}
                  expanded={expandedGroupId === group.id}
                  selected={selected}
                  cleaningIds={cleaningIds}
                  onToggleGroup={() => onToggleGroup(group.id)}
                  onToggleGroupSelected={() =>
                    onToggleCandidates(group.candidates.map((candidate) => candidate.id))
                  }
                  onToggleCandidate={onToggleCandidate}
                />
              ))}

              {groups.length === 0 && (
                <div className="cleanup-session-empty">No sessions in this category.</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CleanupCandidateGroupRow({
  group,
  expanded,
  selected,
  cleaningIds,
  onToggleGroup,
  onToggleGroupSelected,
  onToggleCandidate,
}: {
  group: CleanupCandidateGroup
  expanded: boolean
  selected: string[]
  cleaningIds: string[]
  onToggleGroup: () => void
  onToggleGroupSelected: () => void
  onToggleCandidate: (id: string) => void
}) {
  const selectedInGroup = group.candidates.filter((candidate) => selected.includes(candidate.id))
  const allSelected =
    group.candidates.length > 0 && selectedInGroup.length === group.candidates.length
  const someSelected = selectedInGroup.length > 0 && !allSelected
  const visibleCandidates = group.candidates.slice(0, cleanupMaxVisibleGroupSessions)
  const hiddenCandidateCount = Math.max(0, group.candidates.length - visibleCandidates.length)

  return (
    <div className={`cleanup-group-row ${expanded ? 'is-expanded' : ''}`}>
      <div className="cleanup-group-trigger">
        <button
          type="button"
          onClick={onToggleGroupSelected}
          className={`cleanup-check ${allSelected ? 'is-checked' : ''} ${
            someSelected ? 'is-mixed' : ''
          }`}
          aria-label={`${allSelected ? 'Deselect' : 'Select'} ${group.workspace.label}`}
        >
          {allSelected ? <Check className="size-3.5" /> : someSelected ? '–' : null}
        </button>
        <button
          type="button"
          onClick={onToggleGroup}
          className="cleanup-group-main"
          aria-expanded={expanded}
        >
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-white/90">
              {group.workspace.label}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-white/42">
              {cleanupCompactPath(group.workspace.detail)}
            </span>
          </span>
          <span className={`cleanup-source-pill cleanup-source-pill-${group.source}`}>
            {agentLabel[group.source]}
          </span>
          <span className="text-white/58">{group.candidates.length}</span>
          <span className="text-white/52">
            {group.latestOpened ? formatRelative(group.latestOpened) : 'Unknown'}
          </span>
          <span className="text-right font-medium text-white/72">{formatBytes(group.bytes)}</span>
          <ChevronDown
            className={`cleanup-category-chevron size-4 justify-self-end text-white/58 ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="cleanup-group-details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="cleanup-session-table">
              <div className="cleanup-session-header">
                <span />
                <span>Session</span>
                <span>Source</span>
                <span>Last opened</span>
                <span>Size</span>
                <span>Safety</span>
                <span />
              </div>
              {visibleCandidates.map((candidate) => (
                <CleanupResultSessionRow
                  key={candidate.id}
                  candidate={candidate}
                  checked={selected.includes(candidate.id)}
                  cleaning={cleaningIds.includes(candidate.id)}
                  onToggle={() => onToggleCandidate(candidate.id)}
                />
              ))}
              {hiddenCandidateCount > 0 && (
                <div className="cleanup-session-more">
                  {hiddenCandidateCount} more sessions in this group. Use the group checkbox to
                  select or clear all.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CleanupResultSessionRow({
  candidate,
  checked,
  cleaning,
  onToggle,
}: {
  candidate: CleanupCandidate
  checked: boolean
  cleaning: boolean
  onToggle: () => void
}) {
  const source = candidate.source ?? 'codex'
  const sessionId = candidate.sessionIds[0] ?? candidate.id

  return (
    <div className={`cleanup-session-row ${cleaning ? 'is-cleaning' : ''}`}>
      {cleaning && <div className="cleanup-cleaning-bar" />}
      <button
        type="button"
        onClick={onToggle}
        disabled={cleaning}
        className={`cleanup-check ${checked ? 'is-checked' : ''}`}
        aria-label={`${checked ? 'Deselect' : 'Select'} ${candidate.title}`}
      >
        {checked && <Check className="size-3.5" />}
      </button>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-white/90">{candidate.title}</div>
        <div className="mt-0.5 truncate text-[11px] text-white/42">Session ID: {sessionId}</div>
      </div>
      <span className={`cleanup-source-pill cleanup-source-pill-${source}`}>
        {agentLabel[source]}
      </span>
      <span className="text-white/56">
        {candidate.lastUpdated ? formatRelative(candidate.lastUpdated) : 'Unknown'}
      </span>
      <span className="font-medium text-white/70">{formatBytes(candidate.sizeBytes)}</span>
      <Badge
        variant="outline"
        className="cleanup-safety-pill h-6 justify-center rounded-full px-2.5 text-[11px] ring-1"
      >
        <ShieldCheck className="size-3.5" />
        Safe
      </Badge>
      <button
        type="button"
        className="cleanup-more-button"
        aria-label={`More actions for ${candidate.title}`}
      >
        <MoreHorizontal className="size-4" />
      </button>
    </div>
  )
}
function CleanupCandidateRow({
  candidate,
  checked,
  cleaning,
  index,
  onToggle,
}: {
  candidate: CleanupCandidate
  checked: boolean
  cleaning: boolean
  index: number
  onToggle: () => void
}) {
  const meta = cleanupKindMeta[candidate.kind]
  const Icon = meta.icon

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`cleanup-candidate-row group relative grid min-h-[116px] grid-cols-[30px_52px_minmax(0,1fr)_104px] items-center gap-4 overflow-hidden rounded-lg border px-4 py-4 transition max-[1280px]:grid-cols-[28px_48px_minmax(0,1fr)] ${
            checked
              ? 'border-emerald-300/20 bg-emerald-400/[0.055]'
              : 'border-white/9 bg-white/[0.03] hover:bg-white/[0.055]'
          } ${candidate.risk === 'high' ? 'cleanup-high-risk' : ''} ${cleaning ? 'cleanup-row-removing' : ''}`}
          style={{ animationDelay: `${Math.min(index * 70, 420)}ms` }}
        >
          {cleaning && <div className="cleanup-cleaning-bar" />}
          <button
            type="button"
            onClick={onToggle}
            disabled={cleaning}
            aria-label={`${checked ? 'Deselect' : 'Select'} ${candidate.title}`}
            className={`grid size-6 place-items-center rounded-md border transition ${
              checked
                ? 'border-emerald-300/42 bg-emerald-400/16 text-emerald-200'
                : 'border-white/16 bg-black/12 text-transparent group-hover:text-white/45'
            }`}
          >
            <CheckCircle2 className="size-4" />
          </button>
          <div
            className={`grid size-[52px] place-items-center rounded-lg ring-1 shadow-[inset_0_1px_0_rgb(255_255_255_/_10%)] ${meta.accent}`}
          >
            <Icon className="size-6" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="min-w-0 truncate text-[16px] font-semibold text-white">
                {candidate.title}
              </div>
              <Badge
                variant="outline"
                className={`h-6 rounded-full px-2.5 text-[11px] capitalize ring-1 ${riskAccent[candidate.risk]}`}
              >
                {candidate.risk}
              </Badge>
              <Badge className="h-6 rounded-full bg-white/6 px-2.5 text-[11px] text-white/58 ring-1 ring-white/10">
                {meta.label}
              </Badge>
              {candidate.recoverable && (
                <Badge className="h-6 rounded-full bg-emerald-400/10 px-2.5 text-[11px] text-emerald-300 ring-1 ring-emerald-400/20">
                  recoverable
                </Badge>
              )}
            </div>
            <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-white/52">
              {candidate.reason}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/36">
              <span>
                {candidate.paths.length} path{candidate.paths.length === 1 ? '' : 's'}
              </span>
              {candidate.source && (
                <>
                  <span>/</span>
                  <span>{agentLabel[candidate.source]}</span>
                </>
              )}
              {candidate.lastUpdated && (
                <>
                  <span>/</span>
                  <span>{formatRelative(candidate.lastUpdated)}</span>
                </>
              )}
            </div>
          </div>
          <div className="text-right max-[1280px]:col-start-3 max-[1280px]:text-left">
            <div className="text-[19px] font-semibold text-white">
              {formatBytes(candidate.sizeBytes)}
            </div>
            <div className="mt-1 text-[11px] uppercase text-white/38">
              {candidate.backedUp ? 'backed up' : 'backup first'}
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="chart-tooltip block max-w-[340px] rounded-lg px-3 py-3 text-left text-white">
        <div className="text-xs font-semibold text-white">{candidate.title}</div>
        <div className="mt-1 text-[11px] leading-4 text-white/58">
          {candidate.reason}{' '}
          {candidate.recoverable ? 'This item remains recoverable from app Trash.' : ''}
        </div>
        <div className="mt-2 truncate text-[11px] text-white/38">{candidate.paths[0]}</div>
      </TooltipContent>
    </Tooltip>
  )
}

function CleanupQueuePanel({
  selectedItems,
  selectedBytes,
  firstSelected,
  cleaning,
  cleaned,
  onMoveToTrash,
  onClear,
}: {
  selectedItems: CleanupCandidate[]
  selectedBytes: number
  firstSelected?: CleanupCandidate
  cleaning: boolean
  cleaned: boolean
  onMoveToTrash: () => void
  onClear: () => void
}) {
  const selectedColor = (index: number) =>
    ['bg-emerald-300', 'bg-amber-300', 'bg-blue-300', 'bg-violet-300', 'bg-sky-300'][index % 5]
  const [sizeValue, sizeUnit = ''] = formatBytes(selectedBytes).split(' ')

  return (
    <Card className="glass-panel sticky top-5 h-fit rounded-lg py-0">
      <CardHeader className="flex-row items-center justify-between px-6 pb-0 pt-6">
        <CardTitle className="text-[18px] font-semibold text-white">Clean Queue</CardTitle>
        {cleaned ? (
          <CheckCircle2 className="cleanup-success-pop size-5 text-emerald-300" />
        ) : (
          <Pin className="size-5 text-white/76" />
        )}
      </CardHeader>
      <CardContent className="px-6 pb-6 pt-6">
        <div className="flex items-end gap-2 text-white">
          <span className="text-[42px] font-semibold leading-none">{sizeValue}</span>
          <span className="pb-1 text-[22px] font-semibold">{sizeUnit}</span>
        </div>
        <div className="mt-2 text-sm text-white/52">
          {selectedItems.length} item{selectedItems.length === 1 ? '' : 's'} selected
        </div>

        {firstSelected ? (
          <div className="mt-5 rounded-lg border border-white/8 bg-white/[0.035] p-4">
            <div className="text-xs uppercase text-white/34">Selected detail</div>
            <div className="mt-2 text-sm font-medium text-white">{firstSelected.title}</div>
            <p className="mt-2 text-xs leading-5 text-white/46">{firstSelected.reason}</p>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-white/8 bg-white/[0.03] p-4 text-sm text-white/46">
            Select sessions to build a safe cleanup queue.
          </div>
        )}

        <Separator className="my-6 bg-white/10" />
        <div className="space-y-4 text-[13px] text-white/60">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-4 text-emerald-300" />
            Backed up before removal
          </div>
          <div className="flex items-center gap-3">
            <Trash2 className="size-4 text-blue-300" />
            Moved to app Trash
          </div>
          <div className="flex items-center gap-3">
            <RefreshCcw className="size-4 text-violet-300" />
            Recoverable while retained
          </div>
        </div>
        <Separator className="my-6 bg-white/10" />
        <div className="max-h-[190px] space-y-3 overflow-auto pr-1">
          {selectedItems.map((item, index) => (
            <div key={item.id} className="flex items-center gap-2 text-[13px]">
              <span className={`size-2.5 rounded-full ${selectedColor(index)}`} />
              <span className="min-w-0 flex-1 truncate text-white/56">
                {cleanupKindMeta[item.kind].label}
              </span>
              <span className="text-white/56">{formatBytes(item.sizeBytes)}</span>
            </div>
          ))}
        </div>
        <Button
          onClick={onMoveToTrash}
          disabled={selectedItems.length === 0 || cleaning}
          className={`cleanup-primary-action mt-6 h-11 w-full rounded-lg text-[15px] font-semibold ${
            cleaning
              ? 'bg-emerald-400/80 text-emerald-950'
              : 'bg-blue-500 text-white shadow-[0_12px_28px_rgb(37_99_235_/_28%)] hover:bg-blue-400'
          }`}
        >
          {cleaning ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          {cleaning ? 'Backing up...' : 'Move to Trash'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={selectedItems.length === 0 || cleaning}
          className="mt-2 h-8 w-full text-xs text-white/42 hover:bg-white/7 hover:text-white/70"
        >
          Clear selection
        </Button>
        {cleaned && (
          <div className="cleanup-success-pop mt-3 text-center text-xs font-medium text-emerald-300">
            Cleanup moved to Trash
          </div>
        )}
      </CardContent>
    </Card>
  )
}
