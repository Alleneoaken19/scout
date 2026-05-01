import { useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Square, Calendar, Terminal, Loader2, Zap, Power, PowerOff, AlertCircle, CheckCircle } from 'lucide-react'
import { fetchSchedulerStatus, fetchSchedulerJobs, fetchSchedulerLog, startScheduler, stopScheduler, runSchedulerJob } from '../api'

export default function Scheduler() {
  const queryClient = useQueryClient()
  const logContainerRef = useRef<HTMLDivElement>(null)

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['schedulerStatus'],
    queryFn: fetchSchedulerStatus,
    refetchInterval: 5000,
  })

  const { data: jobsData, isLoading: jobsLoading } = useQuery({
    queryKey: ['schedulerJobs'],
    queryFn: fetchSchedulerJobs,
    refetchInterval: 5000,
  })

  const { data: logData, isLoading: logLoading } = useQuery({
    queryKey: ['schedulerLog'],
    queryFn: () => fetchSchedulerLog(100),
    refetchInterval: 5000,
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['schedulerStatus'] })
    queryClient.invalidateQueries({ queryKey: ['schedulerJobs'] })
    queryClient.invalidateQueries({ queryKey: ['schedulerLog'] })
  }

  const startMutation = useMutation({
    mutationFn: startScheduler,
    onSuccess: () => { setTimeout(invalidateAll, 1500) },
  })

  const stopMutation = useMutation({
    mutationFn: stopScheduler,
    onSuccess: () => { setTimeout(invalidateAll, 1500) },
  })

  const runJobMutation = useMutation({
    mutationFn: (jobId: string) => runSchedulerJob(jobId),
    onSuccess: () => { invalidateAll() },
  })

  const isRunning = status?.running === true
  const daemonPid = status?.pid ?? null
  const jobs: any[] = jobsData?.jobs ?? []
  const logLines: string[] = logData?.log ?? []
  const runningJobs: Record<string, string> = status?.running_jobs ?? {}
  const isMutating = startMutation.isPending || stopMutation.isPending

  // Auto-scroll to bottom when log updates
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logLines])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Scheduler
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Automated job scraping, scoring, and tracking daemon
        </p>
      </div>

      {/* Mutation feedback */}
      {(startMutation.isError || stopMutation.isError || runJobMutation.isError) && (
        <div
          className="rounded-lg px-4 py-3 flex items-center gap-3 border"
          style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)', color: 'var(--danger)' }}
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <p className="text-sm">
            {(startMutation.error as Error)?.message ??
             (stopMutation.error as Error)?.message ??
             (runJobMutation.error as Error)?.message ?? 'An error occurred'}
          </p>
        </div>
      )}

      {(startMutation.isSuccess || stopMutation.isSuccess) && (
        <div
          className="rounded-lg px-4 py-3 flex items-center gap-3 border"
          style={{ background: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.3)', color: 'var(--success)' }}
        >
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <p className="text-sm">
            {startMutation.isSuccess ? 'Daemon started successfully' : 'Daemon stopped successfully'}
          </p>
        </div>
      )}

      {/* Status card with start/stop controls */}
      <div
        className="rounded-xl border p-5"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: isRunning ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
              }}
            >
              {statusLoading || isMutating ? (
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-secondary)' }} />
              ) : isRunning ? (
                <Play className="w-5 h-5" style={{ color: 'var(--success)' }} />
              ) : (
                <Square className="w-5 h-5" style={{ color: 'var(--danger)' }} />
              )}
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Daemon Status
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: statusLoading
                      ? 'var(--text-secondary)'
                      : isRunning
                      ? 'var(--success)'
                      : 'var(--danger)',
                    boxShadow: isRunning ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none',
                    animation: isRunning ? 'pulse 2s infinite' : 'none',
                  }}
                />
                <span
                  className="text-sm font-medium"
                  style={{
                    color: statusLoading
                      ? 'var(--text-secondary)'
                      : isRunning
                      ? 'var(--success)'
                      : 'var(--danger)',
                  }}
                >
                  {statusLoading ? 'Checking...' : isMutating ? 'Processing...' : isRunning ? 'Running' : 'Stopped'}
                </span>
                {daemonPid && isRunning && (
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    PID {daemonPid}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Start / Stop button */}
          <button
            onClick={() => isRunning ? stopMutation.mutate() : startMutation.mutate()}
            disabled={isMutating || statusLoading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
            style={{
              background: isRunning ? 'rgba(239, 68, 68, 0.12)' : 'rgba(34, 197, 94, 0.12)',
              color: isRunning ? 'var(--danger)' : 'var(--success)',
              border: `1px solid ${isRunning ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
              opacity: isMutating || statusLoading ? 0.6 : 1,
              cursor: isMutating || statusLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {isMutating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isRunning ? (
              <PowerOff className="w-4 h-4" />
            ) : (
              <Power className="w-4 h-4" />
            )}
            {isMutating ? 'Processing...' : isRunning ? 'Stop Daemon' : 'Start Daemon'}
          </button>
        </div>
      </div>

      {/* Scheduled jobs table with run-now buttons */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
      >
        <div
          className="px-5 py-4 border-b flex items-center gap-2"
          style={{ borderColor: 'var(--border)' }}
        >
          <Calendar className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Scheduled Jobs
          </h2>
          <span
            className="ml-auto text-xs px-2 py-0.5 rounded-full"
            style={{
              background: 'var(--bg-secondary)',
              color: 'var(--text-secondary)',
            }}
          >
            {jobs.length} job{jobs.length !== 1 ? 's' : ''}
          </span>
        </div>
        {jobsLoading ? (
          <div className="p-5 space-y-3 animate-pulse">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flex gap-4">
                <div className="h-4 w-32 rounded" style={{ background: 'var(--border)' }} />
                <div className="h-4 w-48 rounded" style={{ background: 'var(--border)' }} />
              </div>
            ))}
          </div>
        ) : jobs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Job
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Schedule
                  </th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Status
                  </th>
                  <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job: any, idx: number) => {
                  const jobRunning = job.is_running || job.id in runningJobs
                  const canRun = !jobRunning && job.id !== 'daily_summary' // daily_summary is just a notification

                  return (
                    <tr
                      key={job.id ?? idx}
                      style={{
                        borderBottom: idx < jobs.length - 1 ? '1px solid var(--border)' : 'none',
                      }}
                    >
                      <td className="px-5 py-3.5" style={{ color: 'var(--text-primary)' }}>
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{
                                background: jobRunning ? 'var(--warning)' : 'var(--accent)',
                                boxShadow: jobRunning ? '0 0 6px rgba(234,179,8,0.5)' : 'none',
                                animation: jobRunning ? 'pulse 1.5s infinite' : 'none',
                              }}
                            />
                            <span className="font-medium">{job.name}</span>
                          </div>
                          {job.description && (
                            <p className="text-xs mt-0.5 ml-3.5" style={{ color: 'var(--text-secondary)' }}>
                              {job.description}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <code
                          className="text-xs px-2 py-1 rounded"
                          style={{
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border)',
                          }}
                        >
                          {job.schedule}
                        </code>
                      </td>
                      <td className="px-5 py-3.5">
                        {jobRunning ? (
                          <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--warning)' }}>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Running
                          </span>
                        ) : job.last_status === 'failed' ? (
                          <div>
                            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--danger)' }}>
                              <AlertCircle className="w-3 h-3" />
                              Failed
                            </span>
                            {job.last_error && (
                              <p className="text-xs mt-0.5 ml-4.5 truncate max-w-[280px]" style={{ color: 'var(--danger)', opacity: 0.8 }} title={job.last_error}>
                                {job.last_error}
                              </p>
                            )}
                          </div>
                        ) : job.last_status === 'completed' ? (
                          <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--success)' }}>
                            <CheckCircle className="w-3 h-3" />
                            Completed
                          </span>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Idle</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {canRun && (
                          <button
                            onClick={() => runJobMutation.mutate(job.id)}
                            disabled={runJobMutation.isPending && runJobMutation.variables === job.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                            style={{
                              background: 'var(--bg-secondary)',
                              color: 'var(--accent)',
                              border: '1px solid var(--border)',
                              cursor: 'pointer',
                            }}
                          >
                            <Zap className="w-3 h-3" />
                            Run Now
                          </button>
                        )}
                        {jobRunning && (
                          <span
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                            style={{
                              background: 'rgba(234,179,8,0.08)',
                              color: 'var(--warning)',
                              border: '1px solid rgba(234,179,8,0.2)',
                            }}
                          >
                            <Loader2 className="w-3 h-3 animate-spin" />
                            In Progress
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12">
            <Calendar
              className="w-8 h-8 mb-3"
              style={{ color: 'var(--text-secondary)', opacity: 0.4 }}
            />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              No scheduled jobs configured
            </p>
          </div>
        )}
      </div>

      {/* Log viewer */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
      >
        <div
          className="px-5 py-4 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4" style={{ color: 'var(--success)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Live Log
            </h2>
            {logLines.length > 0 && (
              <span
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
              >
                {logLines.length} lines
              </span>
            )}
          </div>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Auto-refreshes every 5s
          </span>
        </div>
        <div
          ref={logContainerRef}
          className="p-4 overflow-y-auto"
          style={{
            background: '#0d0f14',
            maxHeight: '400px',
            minHeight: '200px',
          }}
        >
          {logLoading ? (
            <div className="space-y-2 animate-pulse">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-3.5 rounded"
                  style={{ background: 'var(--border)', width: `${60 + Math.random() * 40}%` }}
                />
              ))}
            </div>
          ) : logLines.length > 0 ? (
            <div className="space-y-0.5">
              {logLines.map((line, i) => (
                <LogLine key={i} line={line} lineNumber={i + 1} />
              ))}
            </div>
          ) : (
            <p
              className="text-xs font-mono py-4 text-center"
              style={{ color: 'var(--text-secondary)' }}
            >
              No log output yet. Start the daemon or run a job to see output here.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- Sub-components ---------- */

function LogLine({ line, lineNumber }: { line: string; lineNumber: number }) {
  const isError = /error|fail|exception/i.test(line)
  const isWarn = /warn|warning/i.test(line)
  const isInfo = /info|start|running|complete|success|daemon/i.test(line)

  let color = 'var(--text-secondary)'
  if (isError) color = 'var(--danger)'
  else if (isWarn) color = 'var(--warning)'
  else if (isInfo) color = '#6ee7b7'

  return (
    <div className="flex gap-3 font-mono text-xs leading-relaxed group">
      <span
        className="select-none flex-shrink-0 text-right"
        style={{ color: 'var(--border)', width: '3ch' }}
      >
        {lineNumber}
      </span>
      <span style={{ color, wordBreak: 'break-all' }}>{line}</span>
    </div>
  )
}
