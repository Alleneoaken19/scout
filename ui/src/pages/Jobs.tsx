import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
  ExternalLink,
  FileText,
  AlertTriangle,
  Tag,
  SlidersHorizontal,
  CheckCircle,
  XCircle,
  Send,
  ThumbsUp,
  Loader2,
  EyeOff,
  RotateCcw,
  Clock,
} from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { fetchJobs, updateJobStatus, fetchSources, dismissJob, restoreJob, bulkDismissExpired } from '../api'
import InfoTooltip from '../components/InfoTooltip'

const MATCH_TOOLTIP = "AI's assessment of how well this role fits your preferences and resume. Jobs at or above your minimum match score are auto-routed to the apply queue."

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Job {
  id: string
  title: string
  company: string
  location: string
  source: string
  match_score: number | null
  status: string
  url: string
  posted_at: string | null
  deadline: string | null
  applied_at: string | null
  scraped_at: string | null
  recommended_action: string | null
  ats_keywords: string[] | null
  red_flags: string[] | null
  jd_text: string | null
  dismissed_at: string | null
}

type SortKey = 'company' | 'title' | 'location' | 'match_score' | 'source' | 'status' | 'posted_at' | 'deadline' | 'scraped_at'
type SortDir = 'asc' | 'desc'

const STATUSES = [
  'all',
  'scraped',
  'scored',
  'apply_queue',
  'manual_review',
  'applied',
  'interview',
  'offer',
  'rejected',
  'ghosted',
] as const

/* ------------------------------------------------------------------ */
/*  Color helpers                                                      */
/* ------------------------------------------------------------------ */

function scoreColor(score: number | null): { bg: string; text: string } {
  if (score == null) return { bg: 'rgba(161,161,170,0.15)', text: 'var(--text-secondary)' }
  if (score >= 0.8) return { bg: 'rgba(34,197,94,0.18)', text: '#4ade80' }
  if (score >= 0.6) return { bg: 'rgba(245,158,11,0.18)', text: '#fbbf24' }
  if (score >= 0.4) return { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b' }
  return { bg: 'rgba(239,68,68,0.15)', text: '#f87171' }
}

function statusColor(status: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    scraped: { bg: 'rgba(161,161,170,0.15)', text: '#a1a1aa' },
    scored: { bg: 'rgba(99,102,241,0.18)', text: '#a5b4fc' },
    apply_queue: { bg: 'rgba(34,197,94,0.18)', text: '#4ade80' },
    manual_review: { bg: 'rgba(245,158,11,0.18)', text: '#fbbf24' },
    applied: { bg: 'rgba(59,130,246,0.18)', text: '#60a5fa' },
    interview: { bg: 'rgba(139,92,246,0.18)', text: '#a78bfa' },
    offer: { bg: 'rgba(16,185,129,0.2)', text: '#34d399' },
    rejected: { bg: 'rgba(239,68,68,0.15)', text: '#f87171' },
    ghosted: { bg: 'rgba(107,114,128,0.18)', text: '#9ca3af' },
  }
  return map[status] ?? { bg: 'rgba(161,161,170,0.12)', text: 'var(--text-secondary)' }
}

function sourceColor(source: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    arbeitnow: { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa' },
    remoteok: { bg: 'rgba(16,185,129,0.15)', text: '#34d399' },
    indeed: { bg: 'rgba(139,92,246,0.15)', text: '#a78bfa' },
    linkedin: { bg: 'rgba(37,99,235,0.18)', text: '#60a5fa' },
    greenhouse: { bg: 'rgba(34,197,94,0.15)', text: '#4ade80' },
    himalayas: { bg: 'rgba(245,158,11,0.15)', text: '#fbbf24' },
    androidjobs: { bg: 'rgba(99,102,241,0.15)', text: '#a5b4fc' },
    hackernews: { bg: 'rgba(245,158,11,0.18)', text: '#fb923c' },
    landingjobs: { bg: 'rgba(139,92,246,0.15)', text: '#c084fc' },
  }
  return map[source] ?? { bg: 'rgba(161,161,170,0.12)', text: 'var(--text-secondary)' }
}

function formatDate(iso: string | null): string {
  if (!iso) return '--'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatLabel(s: string): string {
  return s
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatScore(score: number | null): string {
  if (score == null) return '--'
  return `${Math.round(score * 100)}%`
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Jobs() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  /* ----- filters ----- */
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '')
  const [source, setSource] = useState(() => searchParams.get('source') ?? 'all')
  const [status, setStatus] = useState(() => searchParams.get('status') ?? 'all')
  const [minScore, setMinScore] = useState(() => Number(searchParams.get('min_score') ?? 0))
  const [hideExpired, setHideExpired] = useState(() => searchParams.get('hide_expired') !== 'false') // default ON
  const [showDismissed, setShowDismissed] = useState(() => searchParams.get('show_dismissed') === 'true')

  // Sync filters → URL (so deep-linking and browser back/forward work)
  useEffect(() => {
    const next = new URLSearchParams()
    if (search.trim()) next.set('search', search.trim())
    if (source !== 'all') next.set('source', source)
    if (status !== 'all') next.set('status', status)
    if (minScore > 0) next.set('min_score', String(minScore))
    if (!hideExpired) next.set('hide_expired', 'false')
    if (showDismissed) next.set('show_dismissed', 'true')
    setSearchParams(next, { replace: true })
  }, [search, source, status, minScore, hideExpired, showDismissed, setSearchParams])

  // React when source param changes externally (e.g. landing from /sources)
  useEffect(() => {
    const urlSource = searchParams.get('source') ?? 'all'
    if (urlSource !== source) setSource(urlSource)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('source')])

  /* ----- fetch available sources for dropdown ----- */
  const { data: sourcesData } = useQuery({
    queryKey: ['sources'],
    queryFn: fetchSources,
  })
  const availableSources = useMemo(() => {
    const names: string[] = (sourcesData?.sources ?? []).map((s: { name: string }) => s.name)
    // Make sure the active source is always selectable, even if it has no jobs
    if (source !== 'all' && !names.includes(source)) names.push(source)
    return ['all', ...names.sort()]
  }, [sourcesData, source])

  /* ----- pagination ----- */
  const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)

  /* ----- sorting ----- */
  const [sortKey, setSortKey] = useState<SortKey>('posted_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  /* ----- modal ----- */
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)

  /* ----- status update mutation ----- */
  const statusMutation = useMutation({
    mutationFn: ({ id, newStatus }: { id: string; newStatus: string }) => updateJobStatus(id, newStatus),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
    },
  })

  const dismissMutation = useMutation({
    mutationFn: (id: string) => dismissJob(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      queryClient.invalidateQueries({ queryKey: ['sources'] })
    },
  })

  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreJob(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      queryClient.invalidateQueries({ queryKey: ['sources'] })
    },
  })

  const bulkExpiredMutation = useMutation({
    mutationFn: () => bulkDismissExpired(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      queryClient.invalidateQueries({ queryKey: ['sources'] })
    },
  })

  function handleStatusChange(job: Job, newStatus: string, e?: React.MouseEvent) {
    e?.stopPropagation()
    statusMutation.mutate({ id: job.id, newStatus })
    // Update modal state if this job is selected
    if (selectedJob?.id === job.id) {
      setSelectedJob({ ...job, status: newStatus })
    }
  }

  /* ----- build query params ----- */
  const params = useMemo(() => {
    const p: Record<string, string> = {}
    if (search.trim()) p.search = search.trim()
    if (source !== 'all') p.source = source
    if (status !== 'all') p.status = status
    if (minScore > 0) p.min_score = String(minScore / 100)
    if (hideExpired) p.hide_expired = 'true'
    if (showDismissed) p.only_dismissed = 'true'
    p.limit = String(pageSize)
    p.offset = String((page - 1) * pageSize)
    p.sort = sortKey
    p.order = sortDir
    return p
  }, [search, source, status, minScore, hideExpired, showDismissed, page, pageSize, sortKey, sortDir])

  // Reset to page 1 when filters change
  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1) }
  }

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['jobs', params],
    queryFn: () => fetchJobs(params),
  })

  const jobs: Job[] = data?.jobs ?? []
  const total: number = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      const descByDefault = ['match_score', 'posted_at', 'deadline', 'scraped_at'].includes(key)
      setSortDir(descByDefault ? 'desc' : 'asc')
    }
    setPage(1)
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronDown className="w-3.5 h-3.5 opacity-30" />
    return sortDir === 'asc' ? (
      <ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
    ) : (
      <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
    )
  }

  const isMutating = statusMutation.isPending

  return (
    <div className="space-y-5">
      {/* ---- Page header ---- */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Jobs
          </h1>
          {source !== 'all' && (
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
              style={{ background: sourceColor(source).bg, color: sourceColor(source).text }}
            >
              Source: {formatLabel(source)}
              <button
                onClick={() => updateFilter(setSource)('all')}
                className="hover:opacity-70"
                title="Clear source filter"
                aria-label="Clear source filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
        </div>
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {total} result{total !== 1 ? 's' : ''}{totalPages > 1 ? ` — Page ${page} of ${totalPages}` : ''}
        </span>
      </div>

      {/* ---- Filter bar ---- */}
      <div
        className="flex flex-wrap items-center gap-3 p-4 rounded-xl"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
      >
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
            style={{ color: 'var(--text-secondary)' }}
          />
          <input
            type="text"
            placeholder="Search jobs..."
            value={search}
            onChange={(e) => updateFilter(setSearch)(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        {/* Source dropdown */}
        <select
          value={source}
          onChange={(e) => updateFilter(setSource)(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm outline-none cursor-pointer"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
          }}
        >
          {availableSources.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All Sources' : formatLabel(s)}
            </option>
          ))}
        </select>

        {/* Status dropdown */}
        <select
          value={status}
          onChange={(e) => updateFilter(setStatus)(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm outline-none cursor-pointer"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All Statuses' : formatLabel(s)}
            </option>
          ))}
        </select>

        {/* Min score */}
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
          <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
            Min Score
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={minScore}
            onChange={(e) => updateFilter(setMinScore)(Number(e.target.value))}
            className="w-24 accent-[var(--accent)]"
          />
          <input
            type="number"
            min={0}
            max={100}
            value={minScore}
            onChange={(e) => updateFilter(setMinScore)(Math.min(100, Math.max(0, Number(e.target.value))))}
            className="w-12 px-1.5 py-1 rounded text-xs text-center outline-none"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        {/* Hide expired toggle */}
        <button
          onClick={() => { setHideExpired((v) => !v); setPage(1) }}
          title={hideExpired ? 'Currently hiding expired jobs' : 'Currently showing expired jobs'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
          style={{
            background: hideExpired ? 'rgba(99,102,241,0.12)' : 'var(--bg-secondary)',
            borderColor: hideExpired ? 'rgba(99,102,241,0.3)' : 'var(--border)',
            color: hideExpired ? 'var(--accent)' : 'var(--text-secondary)',
          }}
        >
          <Clock className="w-3.5 h-3.5" />
          Hide expired
        </button>

        {/* Show dismissed toggle */}
        <button
          onClick={() => { setShowDismissed((v) => !v); setPage(1) }}
          title={showDismissed ? 'Currently showing only dismissed jobs' : 'Show jobs you previously dismissed'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
          style={{
            background: showDismissed ? 'rgba(245,158,11,0.12)' : 'var(--bg-secondary)',
            borderColor: showDismissed ? 'rgba(245,158,11,0.3)' : 'var(--border)',
            color: showDismissed ? 'var(--warning)' : 'var(--text-secondary)',
          }}
        >
          <EyeOff className="w-3.5 h-3.5" />
          {showDismissed ? 'Viewing dismissed' : 'Show dismissed'}
        </button>
      </div>

      {/* Bulk action: dismiss all expired */}
      {!showDismissed && (
        <ExpiredQueueBanner
          onDismissAll={() => bulkExpiredMutation.mutate()}
          isPending={bulkExpiredMutation.isPending}
          dismissed={(bulkExpiredMutation.data as any)?.dismissed}
        />
      )}

      {/* ---- Table ---- */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div
              className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
            />
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm" style={{ color: 'var(--danger)' }}>
            <AlertTriangle className="w-4 h-4" />
            {(error as Error)?.message ?? 'Failed to load jobs'}
          </div>
        ) : jobs.length === 0 ? (
          <div className="py-20 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            No jobs found matching your filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {(
                    [
                      ['company', 'Company', undefined],
                      ['title', 'Title', undefined],
                      ['location', 'Location', undefined],
                      ['match_score', 'Match', MATCH_TOOLTIP],
                      ['source', 'Source', undefined],
                      ['status', 'Status', undefined],
                      ['posted_at', 'Posted', undefined],
                      ['deadline', 'Deadline', undefined],
                      ['scraped_at', 'Scraped', undefined],
                    ] as [SortKey, string, string | undefined][]
                  ).map(([key, label, tooltip]) => (
                    <th
                      key={key}
                      onClick={() => toggleSort(key)}
                      className="px-4 py-3 text-left font-medium cursor-pointer select-none whitespace-nowrap"
                      style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}
                    >
                      <span className="inline-flex items-center gap-1">
                        {label}
                        <SortIcon col={key} />
                        {tooltip && <InfoTooltip text={tooltip} />}
                      </span>
                    </th>
                  ))}
                  <th
                    className="px-4 py-3 text-right font-medium whitespace-nowrap"
                    style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const sc = scoreColor(job.match_score)
                  const stc = statusColor(job.status)
                  const src = sourceColor(job.source)

                  return (
                    <tr
                      key={job.id}
                      onClick={() => navigate(`/jobs/${job.id}`)}
                      className="cursor-pointer transition-colors"
                      style={{
                        borderBottom: '1px solid var(--border)',
                      }}
                      onMouseEnter={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-secondary)'
                      }}
                      onMouseLeave={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                      }}
                    >
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                        {job.company}
                      </td>
                      <td className="px-4 py-3 max-w-[260px] truncate" style={{ color: 'var(--text-primary)' }}>
                        {job.title}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                        {job.location || '--'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-block px-2 py-0.5 rounded-md text-xs font-semibold"
                          style={{ background: sc.bg, color: sc.text }}
                        >
                          {formatScore(job.match_score)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-block px-2 py-0.5 rounded-md text-xs font-medium"
                          style={{ background: src.bg, color: src.text }}
                        >
                          {job.source}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-block px-2 py-0.5 rounded-md text-xs font-medium"
                          style={{ background: stc.bg, color: stc.text }}
                        >
                          {formatLabel(job.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                        {formatDate(job.posted_at)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: job.deadline && new Date(job.deadline) < new Date() ? 'var(--danger)' : 'var(--text-secondary)' }}>
                        {formatDate(job.deadline)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                        {formatDate(job.scraped_at)}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <InlineActions job={job} onAction={handleStatusChange} isMutating={isMutating} />
                          {job.dismissed_at ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); restoreMutation.mutate(job.id) }}
                              disabled={restoreMutation.isPending}
                              title="Restore this job"
                              aria-label="Restore"
                              className="inline-flex items-center justify-center w-7 h-7 rounded transition-all hover:opacity-80 disabled:opacity-50"
                              style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--success)' }}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); dismissMutation.mutate(job.id) }}
                              disabled={dismissMutation.isPending}
                              title="Dismiss this job (hide from default views)"
                              aria-label="Dismiss"
                              className="inline-flex items-center justify-center w-7 h-7 rounded transition-all hover:opacity-80 disabled:opacity-50"
                              style={{ background: 'rgba(161,161,170,0.12)', color: 'var(--text-secondary)' }}
                            >
                              <EyeOff className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- Pagination ---- */}
      {total > pageSize && (
        <div
          className="flex items-center justify-between px-4 py-3 rounded-xl"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Showing {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Per page:</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
                className="px-2 py-1 rounded-lg text-xs outline-none cursor-pointer"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                }}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="p-1.5 rounded-lg transition-colors"
              style={{
                color: page === 1 ? 'var(--border)' : 'var(--text-secondary)',
                cursor: page === 1 ? 'not-allowed' : 'pointer',
              }}
              title="First page"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg transition-colors"
              style={{
                color: page === 1 ? 'var(--border)' : 'var(--text-secondary)',
                cursor: page === 1 ? 'not-allowed' : 'pointer',
              }}
              title="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Page numbers */}
            {(() => {
              const pages: number[] = []
              const start = Math.max(1, page - 2)
              const end = Math.min(totalPages, page + 2)
              for (let i = start; i <= end; i++) pages.push(i)
              return pages.map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className="min-w-[32px] h-8 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    background: p === page ? 'var(--accent)' : 'transparent',
                    color: p === page ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {p}
                </button>
              ))
            })()}

            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-lg transition-colors"
              style={{
                color: page === totalPages ? 'var(--border)' : 'var(--text-secondary)',
                cursor: page === totalPages ? 'not-allowed' : 'pointer',
              }}
              title="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              className="p-1.5 rounded-lg transition-colors"
              style={{
                color: page === totalPages ? 'var(--border)' : 'var(--text-secondary)',
                cursor: page === totalPages ? 'not-allowed' : 'pointer',
              }}
              title="Last page"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ---- Job detail modal ---- */}
      {selectedJob && (
        <JobDetailModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onStatusChange={handleStatusChange}
          isMutating={isMutating}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Expired queue banner                                              */
/* ------------------------------------------------------------------ */

function ExpiredQueueBanner({
  onDismissAll,
  isPending,
  dismissed,
}: {
  onDismissAll: () => void
  isPending: boolean
  dismissed: number | undefined
}) {
  // Use stats API to know how many expired jobs are in active queues
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: async () => {
      const r = await fetch('/api/stats')
      if (!r.ok) return null
      return r.json()
    },
  })

  const expired: number = stats?.expired_in_queue ?? 0
  if (expired === 0 && !dismissed) return null

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border"
      style={{
        background: 'rgba(245,158,11,0.06)',
        borderColor: 'rgba(245,158,11,0.25)',
      }}
    >
      <div className="flex items-center gap-2 text-sm">
        <Clock className="w-4 h-4" style={{ color: 'var(--warning)' }} />
        {dismissed != null ? (
          <span style={{ color: 'var(--text-primary)' }}>
            Dismissed <strong>{dismissed}</strong> expired job{dismissed !== 1 ? 's' : ''}.
          </span>
        ) : (
          <span style={{ color: 'var(--text-primary)' }}>
            <strong>{expired}</strong> expired job{expired !== 1 ? 's' : ''} sitting in your active queue.
          </span>
        )}
      </div>
      {dismissed == null && (
        <button
          onClick={onDismissAll}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80 disabled:opacity-50"
          style={{ background: 'var(--warning)', color: '#fff' }}
        >
          {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <EyeOff className="w-3.5 h-3.5" />}
          Dismiss all expired
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Inline row actions                                                 */
/* ------------------------------------------------------------------ */

function InlineActions({
  job,
  onAction,
  isMutating,
}: {
  job: Job
  onAction: (job: Job, status: string, e?: React.MouseEvent) => void
  isMutating: boolean
}) {
  if (job.status === 'manual_review') {
    return (
      <div className="flex items-center gap-1.5 justify-end">
        <button
          onClick={(e) => onAction(job, 'apply_queue', e)}
          disabled={isMutating}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all hover:opacity-80"
          style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}
          title="Approve for apply queue"
        >
          <ThumbsUp className="w-3 h-3" />
          Approve
        </button>
        <button
          onClick={(e) => onAction(job, 'scored', e)}
          disabled={isMutating}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all hover:opacity-80"
          style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}
          title="Skip this job"
        >
          <XCircle className="w-3 h-3" />
          Skip
        </button>
      </div>
    )
  }

  if (job.status === 'apply_queue') {
    return (
      <button
        onClick={(e) => onAction(job, 'applied', e)}
        disabled={isMutating}
        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all hover:opacity-80"
        style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}
        title="Mark as applied externally"
      >
        <Send className="w-3 h-3" />
        Mark Applied
      </button>
    )
  }

  if (job.status === 'applied') {
    return (
      <div className="flex items-center gap-1.5 justify-end">
        <button
          onClick={(e) => onAction(job, 'interview', e)}
          disabled={isMutating}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all hover:opacity-80"
          style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa' }}
        >
          <CheckCircle className="w-3 h-3" />
          Interview
        </button>
        <button
          onClick={(e) => onAction(job, 'rejected', e)}
          disabled={isMutating}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all hover:opacity-80"
          style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}
        >
          <XCircle className="w-3 h-3" />
          Rejected
        </button>
      </div>
    )
  }

  if (job.status === 'scored') {
    return (
      <button
        onClick={(e) => onAction(job, 'apply_queue', e)}
        disabled={isMutating}
        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all hover:opacity-80"
        style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80' }}
      >
        <ThumbsUp className="w-3 h-3" />
        Queue
      </button>
    )
  }

  return null
}

/* ------------------------------------------------------------------ */
/*  Job detail modal                                                   */
/* ------------------------------------------------------------------ */

function JobDetailModal({
  job,
  onClose,
  onStatusChange,
  isMutating,
}: {
  job: Job
  onClose: () => void
  onStatusChange: (job: Job, status: string, e?: React.MouseEvent) => void
  isMutating: boolean
}) {
  const sc = scoreColor(job.match_score)
  const stc = statusColor(job.status)
  const src = sourceColor(job.source)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl p-6"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-secondary)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLElement).style.background = 'transparent'
          }}
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="pr-10 mb-5">
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {job.title}
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {job.company}
            {job.location ? ` \u2014 ${job.location}` : ''}
          </p>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-semibold"
            style={{ background: sc.bg, color: sc.text }}
          >
            Match: {formatScore(job.match_score)}
          </span>
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium"
            style={{ background: stc.bg, color: stc.text }}
          >
            {formatLabel(job.status)}
          </span>
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium"
            style={{ background: src.bg, color: src.text }}
          >
            {job.source}
          </span>
          {job.recommended_action && (
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium"
              style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--accent-hover)' }}
            >
              Recommended: {formatLabel(job.recommended_action)}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3 mb-5">
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                color: 'var(--accent-hover)',
              }}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View Posting
            </a>
          )}
          <Link
            to={`/resume?job=${job.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              color: 'var(--accent-hover)',
            }}
          >
            <FileText className="w-3.5 h-3.5" />
            Resume Studio
          </Link>

          {/* Status action buttons */}
          {job.status === 'manual_review' && (
            <>
              <button
                onClick={() => onStatusChange(job, 'apply_queue')}
                disabled={isMutating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:opacity-80"
                style={{ background: 'rgba(34,197,94,0.18)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }}
              >
                {isMutating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />}
                Approve for Apply Queue
              </button>
              <button
                onClick={() => onStatusChange(job, 'scored')}
                disabled={isMutating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:opacity-80"
                style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}
              >
                {isMutating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                Skip
              </button>
            </>
          )}

          {(job.status === 'apply_queue' || job.status === 'scored') && (
            <button
              onClick={() => onStatusChange(job, 'applied')}
              disabled={isMutating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:opacity-80"
              style={{ background: 'rgba(59,130,246,0.18)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)' }}
            >
              {isMutating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Mark as Applied
            </button>
          )}

          {job.status === 'applied' && (
            <>
              <button
                onClick={() => onStatusChange(job, 'interview')}
                disabled={isMutating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:opacity-80"
                style={{ background: 'rgba(139,92,246,0.18)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }}
              >
                {isMutating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                Got Interview
              </button>
              <button
                onClick={() => onStatusChange(job, 'rejected')}
                disabled={isMutating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:opacity-80"
                style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}
              >
                {isMutating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                Rejected
              </button>
            </>
          )}
        </div>

        {/* ATS Keywords */}
        {job.ats_keywords && job.ats_keywords.length > 0 && (
          <div className="mb-5">
            <h3
              className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Tag className="w-3.5 h-3.5" />
              ATS Keywords
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {job.ats_keywords.map((kw, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded-md text-xs font-medium"
                  style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}
                >
                  {kw}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Red Flags */}
        {job.red_flags && job.red_flags.length > 0 && (
          <div className="mb-5">
            <h3
              className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider mb-2"
              style={{ color: 'var(--danger)' }}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Red Flags
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {job.red_flags.map((flag, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded-md text-xs font-medium"
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}
                >
                  {flag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* JD Text */}
        <div>
          <h3
            className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            Job Description
          </h3>
          <div
            className="rounded-xl p-4 text-sm leading-relaxed whitespace-pre-wrap"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              maxHeight: '400px',
              overflow: 'auto',
            }}
          >
            {job.jd_text || 'No description available.'}
          </div>
        </div>

        {/* Footer dates */}
        <div className="flex flex-wrap gap-4 mt-5 pt-4 text-xs" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          {job.posted_at && <span>Posted: {formatDate(job.posted_at)}</span>}
          {job.deadline && (
            <span style={{ color: new Date(job.deadline) < new Date() ? 'var(--danger)' : 'var(--text-secondary)' }}>
              Deadline: {formatDate(job.deadline)}
            </span>
          )}
          {job.scraped_at && <span>Scraped: {formatDate(job.scraped_at)}</span>}
          {job.applied_at && <span>Applied: {formatDate(job.applied_at)}</span>}
        </div>
      </div>
    </div>
  )
}
