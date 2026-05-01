import { useQuery } from '@tanstack/react-query'
import { BarChart3, TrendingUp, Users, Send, Trophy, XCircle, Ghost } from 'lucide-react'
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts'
import { fetchStats } from '../api'

const FUNNEL_STAGES = [
  { key: 'scraped', label: 'Scraped', color: '#6366f1' },
  { key: 'scored', label: 'Scored', color: '#8b5cf6' },
  { key: 'apply_queue', label: 'Apply Queue', color: '#f59e0b' },
  { key: 'applied', label: 'Applied', color: '#3b82f6' },
  { key: 'interview', label: 'Interview', color: '#22c55e' },
  { key: 'offer', label: 'Offer', color: '#10b981' },
]

const PIE_COLORS = [
  '#6366f1', '#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b',
  '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#a855f7',
]

export default function Analytics() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Analytics
        </h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl p-5 border animate-pulse"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              <div className="h-3 w-16 rounded mb-3" style={{ background: 'var(--border)' }} />
              <div className="h-6 w-12 rounded" style={{ background: 'var(--border)' }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!stats) return null

  const summaryCards = [
    { label: 'Total Jobs', value: stats.total ?? 0, icon: BarChart3, color: 'var(--accent)' },
    { label: 'Scraped Today', value: stats.scraped_today ?? 0, icon: TrendingUp, color: '#8b5cf6' },
    { label: 'Scored', value: stats.scored ?? 0, icon: TrendingUp, color: '#3b82f6' },
    { label: 'Applied', value: stats.applied ?? 0, icon: Send, color: 'var(--warning)' },
    { label: 'Interviews', value: stats.interviews ?? 0, icon: Users, color: 'var(--success)' },
    { label: 'Offers', value: stats.offers ?? 0, icon: Trophy, color: '#10b981' },
    { label: 'Rejected', value: stats.rejected ?? 0, icon: XCircle, color: 'var(--danger)' },
    { label: 'Ghosted', value: stats.ghosted ?? 0, icon: Ghost, color: 'var(--text-secondary)' },
  ]

  // Pipeline funnel data
  const funnelData = FUNNEL_STAGES.map(({ key, label }) => {
    let value = 0
    if (stats.statuses && stats.statuses[key] !== undefined) {
      value = stats.statuses[key]
    } else if ((stats as any)[key] !== undefined) {
      value = (stats as any)[key]
    }
    return { name: label, value, key }
  })
  const maxFunnel = Math.max(...funnelData.map((d) => d.value), 1)

  // Source data
  const sourceData = stats.sources
    ? Object.entries(stats.sources).map(([name, count]) => ({
        name,
        count: count as number,
      }))
    : []

  // Status data for pie chart
  const statusData = stats.statuses
    ? Object.entries(stats.statuses)
        .filter(([, v]) => (v as number) > 0)
        .map(([name, value]) => ({
          name,
          value: value as number,
        }))
    : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Analytics
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Your job search at a glance
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summaryCards.map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="rounded-xl p-5 border transition-all"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                {label}
              </span>
              <Icon className="w-4 h-4" style={{ color }} />
            </div>
            <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Pipeline funnel */}
      <div
        className="rounded-xl border p-6"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
      >
        <h2 className="text-sm font-semibold mb-5" style={{ color: 'var(--text-primary)' }}>
          Pipeline Funnel
        </h2>
        <div className="space-y-3">
          {funnelData.map((stage, i) => {
            const pct = maxFunnel > 0 ? (stage.value / maxFunnel) * 100 : 0
            const stageColor = FUNNEL_STAGES[i].color
            return (
              <div key={stage.key} className="flex items-center gap-4">
                <span
                  className="w-24 text-xs font-medium text-right flex-shrink-0"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {stage.name}
                </span>
                <div className="flex-1 h-8 rounded-lg overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                  <div
                    className="h-full rounded-lg flex items-center px-3 transition-all duration-500"
                    style={{
                      width: `${Math.max(pct, 2)}%`,
                      background: stageColor,
                      minWidth: stage.value > 0 ? '40px' : '0px',
                    }}
                  >
                    {stage.value > 0 && (
                      <span className="text-xs font-bold text-white">{stage.value}</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Source breakdown */}
        <div
          className="rounded-xl border p-6"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-sm font-semibold mb-5" style={{ color: 'var(--text-primary)' }}>
            Jobs by Source
          </h2>
          {sourceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={sourceData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <XAxis type="number" stroke="var(--text-secondary)" fontSize={11} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke="var(--text-secondary)"
                  fontSize={11}
                  tickLine={false}
                  width={90}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text-primary)',
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {sourceData.map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message="No source data available" />
          )}
        </div>

        {/* Status breakdown */}
        <div
          className="rounded-xl border p-6"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-sm font-semibold mb-5" style={{ color: 'var(--text-primary)' }}>
            Status Distribution
          </h2>
          {statusData.length > 0 ? (
            <div className="flex items-center">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {statusData.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      color: 'var(--text-primary)',
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-2 ml-2 flex-shrink-0">
                {statusData.map((entry, idx) => (
                  <div key={entry.name} className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: PIE_COLORS[idx % PIE_COLORS.length] }}
                    />
                    <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {entry.name} ({entry.value})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyChart message="No status data available" />
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div
      className="flex items-center justify-center h-64 rounded-lg"
      style={{ background: 'var(--bg-secondary)' }}
    >
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {message}
      </p>
    </div>
  )
}
