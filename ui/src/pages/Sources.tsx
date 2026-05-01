import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Database,
  Globe,
  Search,
  Loader2,
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  Target,
  CheckCircle,
  Clock,
} from 'lucide-react'
import { fetchSources } from '../api'
import InfoTooltip from '../components/InfoTooltip'

const AVG_SCORE_TOOLTIP = "Average AI match score across all jobs from this source. Higher means this source consistently surfaces jobs that fit your profile."

interface SourceStat {
  name: string
  total: number
  scored: number
  avg_score: number | null
  last_scraped: string | null
  by_status: Record<string, number>
}

const STATUS_LABEL: Record<string, string> = {
  scraped: 'Scraped',
  scored: 'Scored',
  apply_queue: 'Queue',
  manual_review: 'Review',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  ghosted: 'Ghosted',
}

const STATUS_COLOR: Record<string, string> = {
  scraped: '#94a3b8',
  scored: '#60a5fa',
  apply_queue: 'var(--accent)',
  manual_review: 'var(--warning)',
  applied: '#3b82f6',
  interview: '#8b5cf6',
  offer: 'var(--success)',
  rejected: 'var(--danger)',
  ghosted: '#6b7280',
}

function sourceColor(source: string): { bg: string; text: string; ring: string } {
  // Hash source name to deterministic color from a fixed palette
  const palette = [
    { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa', ring: 'rgba(59,130,246,0.3)' },
    { bg: 'rgba(16,185,129,0.15)', text: '#34d399', ring: 'rgba(16,185,129,0.3)' },
    { bg: 'rgba(139,92,246,0.15)', text: '#a78bfa', ring: 'rgba(139,92,246,0.3)' },
    { bg: 'rgba(245,158,11,0.18)', text: '#fbbf24', ring: 'rgba(245,158,11,0.3)' },
    { bg: 'rgba(236,72,153,0.15)', text: '#f472b6', ring: 'rgba(236,72,153,0.3)' },
    { bg: 'rgba(99,102,241,0.18)', text: '#a5b4fc', ring: 'rgba(99,102,241,0.3)' },
    { bg: 'rgba(34,197,94,0.15)', text: '#4ade80', ring: 'rgba(34,197,94,0.3)' },
    { bg: 'rgba(251,146,60,0.18)', text: '#fb923c', ring: 'rgba(251,146,60,0.3)' },
  ]
  let hash = 0
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) | 0
  return palette[Math.abs(hash) % palette.length]
}

function formatLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  const mo = Math.floor(day / 30)
  return `${mo}mo ago`
}

function scoreColor(score: number | null): string {
  if (score == null) return 'var(--text-secondary)'
  if (score >= 0.65) return 'var(--success)'
  if (score >= 0.4) return 'var(--warning)'
  return 'var(--danger)'
}

type SortKey = 'total' | 'avg_score' | 'last_scraped' | 'name'

export default function Sources() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('total')

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sources'],
    queryFn: fetchSources,
  })

  const sources: SourceStat[] = data?.sources ?? []
  const totalJobs: number = data?.total_jobs ?? 0

  const filtered = useMemo(() => {
    let result = [...sources]
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter((s) => s.name.toLowerCase().includes(q))
    }
    result.sort((a, b) => {
      switch (sortKey) {
        case 'total':
          return b.total - a.total
        case 'avg_score':
          return (b.avg_score ?? -1) - (a.avg_score ?? -1)
        case 'last_scraped':
          return (b.last_scraped ?? '').localeCompare(a.last_scraped ?? '')
        case 'name':
          return a.name.localeCompare(b.name)
      }
    })
    return result
  }, [sources, search, sortKey])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3" style={{ color: 'var(--text-primary)' }}>
            <Database className="w-6 h-6" style={{ color: 'var(--accent)' }} />
            Sources
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Browse jobs by their origin — {sources.length} source{sources.length !== 1 ? 's' : ''} · {totalJobs.toLocaleString()} job{totalJobs !== 1 ? 's' : ''} total
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div
        className="flex flex-wrap items-center gap-3 p-4 rounded-xl"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
      >
        <div className="relative flex-1 min-w-[200px]">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
            style={{ color: 'var(--text-secondary)' }}
          />
          <input
            type="text"
            placeholder="Search sources..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
            Sort by
          </span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="px-3 py-2 rounded-lg text-sm outline-none cursor-pointer"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="total">Most jobs</option>
            <option value="avg_score">Best avg score</option>
            <option value="last_scraped">Most recent</option>
            <option value="name">Name (A-Z)</option>
          </select>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : isError ? (
        <div
          className="flex items-center justify-center gap-2 py-20 text-sm rounded-xl border"
          style={{
            color: 'var(--danger)',
            background: 'rgba(239,68,68,0.05)',
            borderColor: 'rgba(239,68,68,0.2)',
          }}
        >
          <AlertTriangle className="w-4 h-4" />
          {(error as Error)?.message ?? 'Failed to load sources'}
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="py-20 text-center text-sm rounded-xl border"
          style={{
            color: 'var(--text-secondary)',
            background: 'var(--bg-card)',
            borderColor: 'var(--border)',
          }}
        >
          {search ? 'No sources match your search.' : 'No jobs scraped yet. Run a scrape to populate sources.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((s) => (
            <SourceCard
              key={s.name}
              source={s}
              onOpen={() => navigate(`/jobs?source=${encodeURIComponent(s.name)}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SourceCard({ source, onOpen }: { source: SourceStat; onOpen: () => void }) {
  const colors = sourceColor(source.name)
  const queueCount = source.by_status.apply_queue ?? 0
  const appliedCount = source.by_status.applied ?? 0
  const reviewCount = source.by_status.manual_review ?? 0

  return (
    <button
      onClick={onOpen}
      className="text-left rounded-xl p-5 border transition-all hover:opacity-95 hover:scale-[1.01] cursor-pointer group"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border)',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: colors.bg }}
          >
            <Globe className="w-4.5 h-4.5" style={{ color: colors.text }} />
          </div>
          <div className="min-w-0">
            <h3
              className="font-semibold text-base truncate"
              style={{ color: 'var(--text-primary)' }}
              title={source.name}
            >
              {formatLabel(source.name)}
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {source.total.toLocaleString()} job{source.total !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <ArrowUpRight
          className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 flex-shrink-0"
          style={{ color: 'var(--text-secondary)' }}
        />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <Stat
          icon={<Target className="w-3 h-3" />}
          label="Avg Score"
          value={source.avg_score != null ? `${Math.round(source.avg_score * 100)}%` : '—'}
          color={scoreColor(source.avg_score)}
          tooltip={AVG_SCORE_TOOLTIP}
        />
        <Stat
          icon={<CheckCircle className="w-3 h-3" />}
          label="Scored"
          value={source.scored.toLocaleString()}
          color="var(--text-primary)"
        />
        <Stat
          icon={<Clock className="w-3 h-3" />}
          label="Last Scrape"
          value={formatRelative(source.last_scraped)}
          color="var(--text-primary)"
        />
      </div>

      {/* Status pipeline */}
      <div className="space-y-2">
        {/* Highlights */}
        <div className="flex flex-wrap gap-1.5">
          {queueCount > 0 && (
            <Pill label={`${queueCount} in queue`} color={STATUS_COLOR.apply_queue} />
          )}
          {reviewCount > 0 && (
            <Pill label={`${reviewCount} to review`} color={STATUS_COLOR.manual_review} />
          )}
          {appliedCount > 0 && (
            <Pill label={`${appliedCount} applied`} color={STATUS_COLOR.applied} />
          )}
          {queueCount === 0 && reviewCount === 0 && appliedCount === 0 && (
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              No active applications
            </span>
          )}
        </div>

        {/* Tiny bar chart */}
        <StatusBar byStatus={source.by_status} total={source.total} />
      </div>

      {/* Footer hint */}
      <div
        className="mt-4 pt-3 border-t flex items-center gap-1.5"
        style={{ borderColor: 'var(--border)' }}
      >
        <Calendar className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          View all {source.total.toLocaleString()} {formatLabel(source.name)} jobs
        </span>
      </div>
    </button>
  )
}

function Stat({
  icon,
  label,
  value,
  color,
  tooltip,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color: string
  tooltip?: string
}) {
  return (
    <div
      className="rounded-lg p-2"
      style={{ background: 'var(--bg-secondary)' }}
    >
      <div className="flex items-center gap-1 mb-0.5" style={{ color: 'var(--text-secondary)' }}>
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-medium">{label}</span>
        {tooltip && <InfoTooltip text={tooltip} size={10} />}
      </div>
      <div className="text-sm font-semibold truncate" style={{ color }}>
        {value}
      </div>
    </div>
  )
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full font-medium"
      style={{
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
      }}
    >
      {label}
    </span>
  )
}

function StatusBar({ byStatus, total }: { byStatus: Record<string, number>; total: number }) {
  if (total === 0) return null
  // Order matters for visual flow (left to right pipeline)
  const order = ['scraped', 'scored', 'manual_review', 'apply_queue', 'applied', 'interview', 'offer', 'rejected', 'ghosted']
  const segments = order
    .filter((s) => (byStatus[s] ?? 0) > 0)
    .map((s) => ({ status: s, count: byStatus[s], pct: (byStatus[s] / total) * 100 }))

  return (
    <div className="space-y-1.5">
      <div
        className="w-full h-1.5 rounded-full overflow-hidden flex"
        style={{ background: 'var(--bg-secondary)' }}
      >
        {segments.map((seg) => (
          <div
            key={seg.status}
            title={`${STATUS_LABEL[seg.status] ?? seg.status}: ${seg.count}`}
            style={{
              width: `${seg.pct}%`,
              background: STATUS_COLOR[seg.status] ?? 'var(--text-secondary)',
            }}
          />
        ))}
      </div>
    </div>
  )
}
