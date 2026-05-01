import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Briefcase,
  CalendarCheck,
  Zap,
  ListChecks,
  Send,
  Users,
  X,
  ExternalLink,
  MapPin,
  Globe,
  Target,
  AlertTriangle,
  Lightbulb,
  FileText,
  Copy as CopyIcon,
  Sparkles,
  Loader2,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { fetchStats, fetchJobs, updateJobStatus, fetchDuplicates, dedupeJobs } from '../api'
import InfoTooltip from '../components/InfoTooltip'

const MATCH_TOOLTIP = "AI's assessment of how well this role fits your preferences and resume. Jobs at or above your minimum match score are auto-routed to the apply queue."

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Job {
  id: string
  title: string
  company: string
  location: string
  source: string
  match_score: number | null
  status: string
  ats_keywords: string[]
  red_flags: string[]
  recommended_action: string
  url: string
  scraped_at: string
}

interface Stats {
  total: number
  scraped_today: number
  scored: number
  unscored: number
  applied: number
  interviews: number
  offers: number
  rejected: number
  ghosted: number
  apply_queue: number
  manual_review: number
  statuses: Record<string, number>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KANBAN_COLUMNS: { key: string; label: string; color: string }[] = [
  { key: 'apply_queue', label: 'Apply Queue', color: 'var(--accent)' },
  { key: 'manual_review', label: 'Manual Review', color: 'var(--warning)' },
  { key: 'applied', label: 'Applied', color: '#3b82f6' },
  { key: 'interview', label: 'Interview', color: '#8b5cf6' },
  { key: 'offer', label: 'Offer', color: 'var(--success)' },
  { key: 'rejected', label: 'Rejected', color: 'var(--danger)' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// match_score is stored as a float 0.0-1.0 in the API. These helpers expect
// that range and handle conversion to percent at display time.
function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'var(--text-secondary)'
  if (score >= 0.65) return 'var(--success)'
  if (score >= 0.4) return 'var(--warning)'
  return 'var(--danger)'
}

function scoreBg(score: number | null | undefined): string {
  if (score == null) return 'rgba(161,161,170,0.1)'
  if (score >= 0.65) return 'rgba(34,197,94,0.15)'
  if (score >= 0.4) return 'rgba(245,158,11,0.15)'
  return 'rgba(239,68,68,0.15)'
}

function formatScore(score: number | null | undefined): string {
  if (score == null) return 'N/A'
  return `${Math.round(score * 100)}%`
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  value,
  label,
  borderColor,
}: {
  icon: React.ElementType
  value: number | undefined
  label: string
  borderColor: string
}) {
  return (
    <div
      className="rounded-xl px-5 py-4 flex items-center gap-4 transition-all duration-200"
      style={{
        background: 'var(--bg-card)',
        borderLeft: `4px solid ${borderColor}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: `${borderColor}20` }}
      >
        <Icon className="w-5 h-5" style={{ color: borderColor }} />
      </div>
      <div>
        <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {value ?? '-'}
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sortable Job Card (Kanban)
// ---------------------------------------------------------------------------

function SortableJobCard({
  job,
  onClick,
}: {
  job: Job
  onClick: (job: Job) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: job.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(job)}
    >
      <JobCardContent job={job} />
    </div>
  )
}

function JobCardContent({ job }: { job: Job }) {
  return (
    <div
      className="rounded-lg p-3.5 cursor-pointer transition-all duration-150 hover:scale-[1.02] mb-2"
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
      }}
    >
      <div className="font-semibold text-sm leading-tight" style={{ color: 'var(--text-primary)' }}>
        {job.company}
      </div>
      <div
        className="text-xs mt-1 leading-snug line-clamp-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        {job.title}
      </div>
      <div className="flex items-center justify-between mt-2.5">
        {job.match_score != null ? (
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{
              color: scoreColor(job.match_score),
              background: scoreBg(job.match_score),
            }}
          >
            {formatScore(job.match_score)}
          </span>
        ) : (
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ color: 'var(--text-secondary)', background: 'rgba(161,161,170,0.1)' }}
          >
            N/A
          </span>
        )}
        <span
          className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-medium"
          style={{
            color: 'var(--text-secondary)',
            background: 'rgba(161,161,170,0.1)',
          }}
        >
          {job.source}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Kanban Column (droppable)
// ---------------------------------------------------------------------------

function KanbanColumn({
  column,
  jobs,
  onCardClick,
}: {
  column: (typeof KANBAN_COLUMNS)[number]
  jobs: Job[]
  onCardClick: (job: Job) => void
}) {
  const { setNodeRef } = useSortable({
    id: `column-${column.key}`,
    data: { type: 'column', column: column.key },
    disabled: true,
  })

  return (
    <div
      className="flex flex-col min-w-[260px] max-w-[300px] w-full rounded-xl"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
      }}
    >
      {/* Column header */}
      <div
        className="flex items-center justify-between px-4 py-3 rounded-t-xl"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ background: column.color }}
          />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {column.label}
          </span>
        </div>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{
            color: column.color,
            background: `${column.color}18`,
          }}
        >
          {jobs.length}
        </span>
      </div>

      {/* Column body */}
      <div ref={setNodeRef} className="flex-1 p-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
        <SortableContext
          items={jobs.map((j) => j.id)}
          strategy={verticalListSortingStrategy}
        >
          {jobs.map((job) => (
            <SortableJobCard key={job.id} job={job} onClick={onCardClick} />
          ))}
          {jobs.length === 0 && (
            <div
              className="text-xs text-center py-8 rounded-lg"
              style={{ color: 'var(--text-secondary)', border: '1px dashed var(--border)' }}
            >
              No jobs
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Slide-over Detail Panel (available for future use)
// ---------------------------------------------------------------------------

export function SlideOver({
  job,
  onClose,
}: {
  job: Job | null
  onClose: () => void
}) {
  if (!job) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-300"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 z-50 h-full w-full max-w-md overflow-y-auto transition-transform duration-300"
        style={{
          background: 'var(--bg-secondary)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 sticky top-0 z-10"
          style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}
        >
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Job Details
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Company + Title */}
          <div>
            <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {job.company}
            </div>
            <div className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              {job.title}
            </div>
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap gap-3">
            {job.location && (
              <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <MapPin className="w-3.5 h-3.5" />
                {job.location}
              </div>
            )}
            {job.source && (
              <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <Globe className="w-3.5 h-3.5" />
                {job.source}
              </div>
            )}
          </div>

          {/* Links */}
          <div className="flex flex-wrap items-center gap-4">
            {job.url && (
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:opacity-80"
                style={{ color: 'var(--accent)' }}
              >
                <ExternalLink className="w-4 h-4" />
                View Posting
              </a>
            )}
            <Link
              to={`/resume?job=${job.id}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: 'var(--accent)' }}
            >
              <FileText className="w-4 h-4" />
              Resume Studio
            </Link>
          </div>

          {/* Match Score */}
          <div>
            <div className="text-xs uppercase tracking-wider font-medium mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
              Match Score
              <InfoTooltip text={MATCH_TOOLTIP} />
            </div>
            <div className="flex items-center gap-3">
              <div
                className="text-4xl font-extrabold"
                style={{ color: scoreColor(job.match_score) }}
              >
                {formatScore(job.match_score)}
              </div>
              <Target className="w-6 h-6" style={{ color: scoreColor(job.match_score) }} />
            </div>
            {/* Score bar */}
            {job.match_score != null && (
              <div className="mt-2 w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(job.match_score * 100, 100)}%`,
                    background: scoreColor(job.match_score),
                  }}
                />
              </div>
            )}
          </div>

          {/* ATS Keywords */}
          {job.ats_keywords && job.ats_keywords.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                ATS Keywords
              </div>
              <div className="flex flex-wrap gap-1.5">
                {job.ats_keywords.map((kw, i) => (
                  <span
                    key={i}
                    className="text-xs px-2.5 py-1 rounded-full font-medium"
                    style={{
                      background: 'rgba(99,102,241,0.15)',
                      color: 'var(--accent)',
                    }}
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Red Flags */}
          {job.red_flags && job.red_flags.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider font-medium mb-2" style={{ color: 'var(--danger)' }}>
                <AlertTriangle className="w-3.5 h-3.5" />
                Red Flags
              </div>
              <div className="flex flex-wrap gap-1.5">
                {job.red_flags.map((flag, i) => (
                  <span
                    key={i}
                    className="text-xs px-2.5 py-1 rounded-full font-medium"
                    style={{
                      background: 'rgba(239,68,68,0.15)',
                      color: 'var(--danger)',
                    }}
                  >
                    {flag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recommended Action */}
          {job.recommended_action && (
            <div
              className="rounded-lg p-4"
              style={{
                background: 'rgba(99,102,241,0.08)',
                border: '1px solid rgba(99,102,241,0.2)',
              }}
            >
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider font-medium mb-2" style={{ color: 'var(--accent)' }}>
                <Lightbulb className="w-3.5 h-3.5" />
                Recommended Action
              </div>
              <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {job.recommended_action}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [activeJob, setActiveJob] = useState<Job | null>(null)

  // Fetch stats
  const { data: stats } = useQuery<Stats>({
    queryKey: ['stats'],
    queryFn: fetchStats,
    refetchInterval: 30_000,
  })

  // Fetch all jobs for kanban
  const { data: jobsData } = useQuery<{ jobs: Job[]; total: number }>({
    queryKey: ['jobs', 'kanban'],
    queryFn: () => fetchJobs({ limit: '500' }),
    refetchInterval: 30_000,
  })

  const jobs = jobsData?.jobs ?? []

  // Group jobs by status
  const jobsByStatus: Record<string, Job[]> = {}
  for (const col of KANBAN_COLUMNS) {
    jobsByStatus[col.key] = jobs.filter((j) => j.status === col.key)
  }

  // Mutation for updating status
  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateJobStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
    },
  })

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  )

  // Determine which column a droppable id belongs to
  const findColumnForId = useCallback(
    (id: string): string | null => {
      // Check if id is a column itself
      for (const col of KANBAN_COLUMNS) {
        if (id === `column-${col.key}`) return col.key
      }
      // Check if it's a job id
      const job = jobs.find((j) => j.id === id)
      return job?.status ?? null
    },
    [jobs],
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event
      const job = jobs.find((j) => j.id === active.id)
      if (job) setActiveJob(job)
    },
    [jobs],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveJob(null)

      if (!over) return

      const activeId = active.id as string
      const overId = over.id as string

      const sourceColumn = findColumnForId(activeId)
      let destColumn = findColumnForId(overId)

      // If dropping over a column container directly
      if (overId.startsWith('column-')) {
        destColumn = overId.replace('column-', '')
      }

      if (!sourceColumn || !destColumn) return
      if (sourceColumn === destColumn) return

      // Optimistic update in local cache
      queryClient.setQueryData<{ jobs: Job[]; total: number }>(
        ['jobs', 'kanban'],
        (old) => {
          if (!old) return old
          return {
            ...old,
            jobs: old.jobs.map((j) =>
              j.id === activeId ? { ...j, status: destColumn! } : j,
            ),
          }
        },
      )

      mutation.mutate({ id: activeId, status: destColumn })
    },
    [findColumnForId, mutation, queryClient],
  )

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Dashboard
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Overview of your job search pipeline
        </p>
      </div>

      {/* Dedup banner — only renders when duplicates exist */}
      <DedupBanner />


      {/* ----------------------------------------------------------------- */}
      {/* Stat Cards Row                                                     */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard
          icon={Briefcase}
          value={stats?.total}
          label="Total Jobs"
          borderColor="var(--accent)"
        />
        <StatCard
          icon={CalendarCheck}
          value={stats?.scraped_today}
          label="Scraped Today"
          borderColor="var(--success)"
        />
        <StatCard
          icon={Zap}
          value={stats?.scored}
          label="Scored"
          borderColor="var(--warning)"
        />
        <StatCard
          icon={ListChecks}
          value={stats?.apply_queue}
          label="Apply Queue"
          borderColor="#8b5cf6"
        />
        <StatCard
          icon={Send}
          value={stats?.applied}
          label="Applied"
          borderColor="#3b82f6"
        />
        <StatCard
          icon={Users}
          value={stats?.interviews}
          label="Interviews"
          borderColor="#ec4899"
        />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Kanban Board                                                       */}
      {/* ----------------------------------------------------------------- */}
      <div>
        <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
          Pipeline
        </h2>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto pb-4">
            {KANBAN_COLUMNS.map((col) => (
              <KanbanColumn
                key={col.key}
                column={col}
                jobs={jobsByStatus[col.key] ?? []}
                onCardClick={(job) => navigate(`/jobs/${job.id}`)}
              />
            ))}
          </div>

          <DragOverlay>
            {activeJob ? (
              <div className="w-[280px]">
                <JobCardContent job={activeJob} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

    </div>
  )
}

// ---------------------------------------------------------------------------
// DedupBanner — surfaces duplicate jobs and offers a one-click cleanup
// ---------------------------------------------------------------------------

interface DupGroup {
  canonical: { company: string; title: string; status: string }
  losers: { location: string; status: string; source: string }[]
  loser_count: number
}

interface DupPreview {
  mode: string
  group_count: number
  duplicate_count: number
  groups: DupGroup[]
}

function DedupBanner() {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'strict' | 'by_role'>('strict')
  const [showDetails, setShowDetails] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [justDeduped, setJustDeduped] = useState<{ groups: number; jobs: number } | null>(null)

  const { data: preview } = useQuery<DupPreview>({
    queryKey: ['duplicates', mode],
    queryFn: () => fetchDuplicates(mode),
    staleTime: 30_000,
  })

  const dedupMutation = useMutation({
    mutationFn: () => dedupeJobs(mode),
    onSuccess: (result: any) => {
      setJustDeduped({
        groups: result.groups_processed,
        jobs: result.jobs_removed,
      })
      setConfirming(false)
      setShowDetails(false)
      queryClient.invalidateQueries({ queryKey: ['duplicates'] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      queryClient.invalidateQueries({ queryKey: ['sources'] })
      setTimeout(() => setJustDeduped(null), 8000)
    },
  })

  if (justDeduped) {
    return (
      <div
        className="rounded-xl border px-4 py-3 flex items-center gap-3"
        style={{
          background: 'rgba(34,197,94,0.06)',
          borderColor: 'rgba(34,197,94,0.25)',
        }}
      >
        <Sparkles className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--success)' }} />
        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
          Cleaned up <strong>{justDeduped.jobs}</strong> duplicate job{justDeduped.jobs !== 1 ? 's' : ''} across <strong>{justDeduped.groups}</strong> group{justDeduped.groups !== 1 ? 's' : ''}.
        </span>
      </div>
    )
  }

  if (!preview || preview.duplicate_count === 0) return null

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        background: 'rgba(245,158,11,0.06)',
        borderColor: 'rgba(245,158,11,0.25)',
      }}
    >
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          <CopyIcon className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--warning)' }} />
          <span style={{ color: 'var(--text-primary)' }}>
            <strong>{preview.duplicate_count}</strong> duplicate job{preview.duplicate_count !== 1 ? 's' : ''} across{' '}
            <strong>{preview.group_count}</strong> group{preview.group_count !== 1 ? 's' : ''}
            {mode === 'by_role' && <span className="ml-1 opacity-70">(includes multi-location variants)</span>}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Mode toggle */}
          <div className="inline-flex items-center rounded-lg p-0.5" style={{ background: 'var(--bg-secondary)' }}>
            <button
              onClick={() => { setMode('strict'); setShowDetails(false) }}
              className="px-2.5 py-1 rounded text-xs font-medium transition-all"
              style={{
                background: mode === 'strict' ? 'var(--bg-card)' : 'transparent',
                color: mode === 'strict' ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              Exact
            </button>
            <button
              onClick={() => { setMode('by_role'); setShowDetails(false) }}
              title="Also collapse multi-location variants of the same role"
              className="px-2.5 py-1 rounded text-xs font-medium transition-all"
              style={{
                background: mode === 'by_role' ? 'var(--bg-card)' : 'transparent',
                color: mode === 'by_role' ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              + Multi-location
            </button>
          </div>
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
              background: 'var(--bg-card)',
            }}
          >
            {showDetails ? 'Hide details' : 'Preview'}
          </button>
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
              style={{ background: 'var(--warning)', color: '#fff' }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Clean up
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setConfirming(false)}
                disabled={dedupMutation.isPending}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80 disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-card)' }}
              >
                Cancel
              </button>
              <button
                onClick={() => dedupMutation.mutate()}
                disabled={dedupMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80 disabled:opacity-50"
                style={{ background: 'var(--danger)', color: '#fff' }}
              >
                {dedupMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                Confirm — remove {preview.duplicate_count}
              </button>
            </div>
          )}
        </div>
      </div>

      {showDetails && (
        <div
          className="border-t px-4 py-3 max-h-72 overflow-y-auto space-y-2"
          style={{ borderColor: 'rgba(245,158,11,0.18)' }}
        >
          {preview.groups.slice(0, 20).map((g, i) => (
            <div
              key={i}
              className="rounded-lg p-2.5 text-xs"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {g.canonical.company} — {g.canonical.title}
                </span>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
                  style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--accent)' }}
                >
                  Keep ({g.canonical.status})
                </span>
              </div>
              <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                Removes <strong>{g.loser_count}</strong> dupe{g.loser_count !== 1 ? 's' : ''}
                {mode === 'by_role' && g.losers.length > 0 && (
                  <span className="ml-1">— locations: {Array.from(new Set(g.losers.map((l) => l.location).filter(Boolean))).join(', ')}</span>
                )}
              </div>
            </div>
          ))}
          {preview.groups.length > 20 && (
            <p className="text-xs text-center pt-1" style={{ color: 'var(--text-secondary)' }}>
              …and {preview.groups.length - 20} more groups
            </p>
          )}
        </div>
      )}
    </div>
  )
}
