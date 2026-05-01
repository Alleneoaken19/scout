import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  MapPin,
  Globe,
  Target,
  AlertTriangle,
  Lightbulb,
  Calendar,
  CheckCircle,
  XCircle,
  Send,
  Users,
  Award,
  Clock,
  Tag,
  ChevronRight,
  ChevronDown,
  Loader2,
  Copy,
  Check,
  Mail,
  Save,
  BookOpen,
  Edit3,
  Sparkles,
  EyeOff,
  RotateCcw,
} from 'lucide-react'
import { fetchJob, updateJobStatus, updateJobResearchNotes, updateJobDescription, scoreJob, dismissJob, restoreJob, fetchTailoredResume, fetchJobGap } from '../api'
import InfoTooltip from '../components/InfoTooltip'

/* ------------------------------------------------------------------ */
/*  Score explanations (kept centralized for consistent wording)       */
/* ------------------------------------------------------------------ */

const TOOLTIPS = {
  match: "AI's assessment of how well this role fits your preferences and resume. Jobs at or above your minimum match score are auto-routed to the apply queue.",
  tailoredAts: "Fraction of job-description keywords found in the tailored resume that gets submitted with this application. Higher = better ATS pass-through.",
  keywordMatch: "Fraction of job-description keywords already present in your master resume. Reveals the gap your tailored resume needs to close.",
}

/* ------------------------------------------------------------------ */
/*  Status config                                                      */
/* ------------------------------------------------------------------ */

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  scraped:       { label: 'Scraped',        color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
  scored:        { label: 'Scored',         color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  apply_queue:   { label: 'Apply Queue',    color: 'var(--accent)', bg: 'rgba(99,102,241,0.12)' },
  manual_review: { label: 'Manual Review',  color: 'var(--warning)', bg: 'rgba(245,158,11,0.12)' },
  applied:       { label: 'Applied',        color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  interview:     { label: 'Interview',      color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
  offer:         { label: 'Offer',          color: 'var(--success)', bg: 'rgba(34,197,94,0.12)' },
  rejected:      { label: 'Rejected',       color: 'var(--danger)', bg: 'rgba(239,68,68,0.12)' },
  ghosted:       { label: 'Ghosted',        color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
}

// Which statuses can transition to what
const STATUS_TRANSITIONS: Record<string, { label: string; to: string; icon: any; style: 'primary' | 'success' | 'danger' | 'neutral' }[]> = {
  scraped:       [
    { label: 'Score & Review', to: 'manual_review', icon: Target, style: 'primary' },
  ],
  scored:        [
    { label: 'Add to Apply Queue', to: 'apply_queue', icon: Send, style: 'primary' },
    { label: 'Needs Review', to: 'manual_review', icon: Target, style: 'neutral' },
    { label: 'Reject', to: 'rejected', icon: XCircle, style: 'danger' },
  ],
  manual_review: [
    { label: 'Approve for Apply Queue', to: 'apply_queue', icon: CheckCircle, style: 'success' },
    { label: 'Skip', to: 'scored', icon: ChevronRight, style: 'neutral' },
    { label: 'Reject', to: 'rejected', icon: XCircle, style: 'danger' },
  ],
  apply_queue:   [
    { label: 'Mark as Applied', to: 'applied', icon: Send, style: 'primary' },
    { label: 'Needs Review', to: 'manual_review', icon: Target, style: 'neutral' },
    { label: 'Reject', to: 'rejected', icon: XCircle, style: 'danger' },
  ],
  applied:       [
    { label: 'Got Interview', to: 'interview', icon: Users, style: 'success' },
    { label: 'Rejected', to: 'rejected', icon: XCircle, style: 'danger' },
    { label: 'Ghosted', to: 'ghosted', icon: Clock, style: 'neutral' },
  ],
  interview:     [
    { label: 'Got Offer', to: 'offer', icon: Award, style: 'success' },
    { label: 'Rejected', to: 'rejected', icon: XCircle, style: 'danger' },
    { label: 'Ghosted', to: 'ghosted', icon: Clock, style: 'neutral' },
  ],
  offer:         [
    { label: 'Mark Rejected', to: 'rejected', icon: XCircle, style: 'danger' },
  ],
  rejected:      [
    { label: 'Reconsider', to: 'apply_queue', icon: Send, style: 'neutral' },
  ],
  ghosted:       [
    { label: 'Reconsider', to: 'apply_queue', icon: Send, style: 'neutral' },
  ],
}

const TRANSITION_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  primary: { bg: 'var(--accent)', color: '#fff', border: 'transparent' },
  success: { bg: 'rgba(34,197,94,0.15)', color: 'var(--success)', border: 'rgba(34,197,94,0.3)' },
  danger:  { bg: 'rgba(239,68,68,0.1)', color: 'var(--danger)', border: 'rgba(239,68,68,0.25)' },
  neutral: { bg: 'var(--bg-secondary)', color: 'var(--text-primary)', border: 'var(--border)' },
}

// Scores are 0.0-1.0 floats. Helpers expect that range and handle conversion
// to percent at display time. Use formatScore() for the visible string.
function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'var(--text-secondary)'
  if (score >= 0.65) return 'var(--success)'
  if (score >= 0.4) return 'var(--warning)'
  return 'var(--danger)'
}

function formatScore(score: number | null | undefined): string {
  if (score == null) return 'N/A'
  return `${Math.round(score * 100)}%`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function JobDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)

  const [researchNotes, setResearchNotes] = useState('')
  const [isEditingNotes, setIsEditingNotes] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)
  const [jdDraft, setJdDraft] = useState('')
  const [isEditingJd, setIsEditingJd] = useState(false)
  const [jdSaved, setJdSaved] = useState(false)

  const { data: job, isLoading, error } = useQuery({
    queryKey: ['job', id],
    queryFn: () => fetchJob(id!),
    enabled: !!id,
  })

  useEffect(() => {
    if (job?.research_notes != null) {
      setResearchNotes(job.research_notes)
    }
  }, [job?.research_notes])

  useEffect(() => {
    setJdDraft(job?.jd_text ?? '')
  }, [job?.jd_text])

  const [showMatching, setShowMatching] = useState(false)

  const { data: resumeData } = useQuery({
    queryKey: ['tailoredResume', id],
    queryFn: async () => {
      try { return await fetchTailoredResume(id!) } catch { return null }
    },
    enabled: !!id,
  })

  const { data: gapData, isLoading: gapLoading, error: gapError } = useQuery({
    queryKey: ['jobGap', id],
    queryFn: () => fetchJobGap(id!),
    enabled: !!id && !!job?.jd_text,
  })

  const statusMutation = useMutation({
    mutationFn: (newStatus: string) => updateJobStatus(id!, newStatus),
    onSuccess: (updated) => {
      queryClient.setQueryData(['job', id], updated)
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
    },
  })

  const notesMutation = useMutation({
    mutationFn: (notes: string) => updateJobResearchNotes(id!, notes),
    onSuccess: (updated) => {
      queryClient.setQueryData(['job', id], updated)
      setIsEditingNotes(false)
      setNotesSaved(true)
      setTimeout(() => setNotesSaved(false), 2000)
    },
  })

  const scoreMutation = useMutation({
    mutationFn: () => scoreJob(id!),
    onSuccess: (updated) => {
      queryClient.setQueryData(['job', id], updated)
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      queryClient.invalidateQueries({ queryKey: ['jobGap', id] })
    },
  })

  const jdMutation = useMutation({
    mutationFn: (text: string) => updateJobDescription(id!, text),
    onSuccess: (updated) => {
      queryClient.setQueryData(['job', id], updated)
      queryClient.invalidateQueries({ queryKey: ['jobGap', id] })
      setIsEditingJd(false)
      setJdSaved(true)
      setTimeout(() => setJdSaved(false), 2000)
    },
  })

  const dismissMutation = useMutation({
    mutationFn: () => (job?.dismissed_at ? restoreJob(id!) : dismissJob(id!)),
    onSuccess: (updated) => {
      queryClient.setQueryData(['job', id], updated)
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      queryClient.invalidateQueries({ queryKey: ['sources'] })
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    )
  }

  if (error || !job) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Job not found</p>
        <button
          onClick={() => navigate('/jobs')}
          className="text-sm font-medium"
          style={{ color: 'var(--accent)' }}
        >
          Back to Jobs
        </button>
      </div>
    )
  }

  const status = job.status || 'scraped'
  const statusInfo = STATUS_META[status] || STATUS_META.scraped
  const transitions = STATUS_TRANSITIONS[status] || []
  const hasResume = !!resumeData?.pdf_path
  const coverLetter = resumeData?.cover_letter ?? null

  const handleCopy = async () => {
    if (!coverLetter) return
    await navigator.clipboard.writeText(coverLetter)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Back link */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm font-medium transition-colors hover:opacity-80"
        style={{ color: 'var(--text-secondary)' }}
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      {/* Header card */}
      <div
        className="rounded-xl border p-6"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          {/* Left: Title & meta */}
          <div className="space-y-3 flex-1 min-w-0">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {job.title}
              </h1>
              <p className="text-lg mt-1" style={{ color: 'var(--text-secondary)' }}>
                {job.company}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {job.location && (
                <span className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <MapPin className="w-3.5 h-3.5" />
                  {job.location}
                </span>
              )}
              {job.source && (
                <span className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <Globe className="w-3.5 h-3.5" />
                  {job.source}
                </span>
              )}
              {job.posted_at && (
                <span className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <Calendar className="w-3.5 h-3.5" />
                  Posted {formatDate(job.posted_at)}
                </span>
              )}
              {job.deadline && (
                <span
                  className="flex items-center gap-1.5 text-sm"
                  style={{ color: new Date(job.deadline) < new Date() ? 'var(--danger)' : 'var(--warning)' }}
                >
                  <Clock className="w-3.5 h-3.5" />
                  Deadline {formatDate(job.deadline)}
                </span>
              )}
              {job.scraped_at && (
                <span className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <Calendar className="w-3.5 h-3.5" />
                  Scraped {formatDate(job.scraped_at)}
                </span>
              )}
              {job.applied_at && (
                <span className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--success)' }}>
                  <CheckCircle className="w-3.5 h-3.5" />
                  Applied {formatDate(job.applied_at)}
                </span>
              )}
            </div>
          </div>

          {/* Right: Score + status */}
          <div className="flex items-center gap-4 flex-shrink-0">
            {/* Match score */}
            {job.match_score != null && (
              <div className="text-center">
                <div
                  className="text-3xl font-extrabold"
                  style={{ color: scoreColor(job.match_score) }}
                >
                  {formatScore(job.match_score)}
                </div>
                <p className="text-xs mt-0.5 flex items-center justify-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                  Match
                  <InfoTooltip text={TOOLTIPS.match} />
                </p>
              </div>
            )}
            {/* Status badge */}
            <span
              className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap"
              style={{ background: statusInfo.bg, color: statusInfo.color }}
            >
              {statusInfo.label}
            </span>
          </div>
        </div>
      </div>

      {/* Score error banner */}
      {scoreMutation.isError && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{
            background: 'rgba(239,68,68,0.08)',
            borderColor: 'rgba(239,68,68,0.25)',
            color: 'var(--danger)',
          }}
        >
          Scoring failed: {(scoreMutation.error as Error).message}
        </div>
      )}

      {/* Actions row */}
      <div className="flex flex-wrap gap-3">
        {/* Status transitions */}
        {transitions.map((t) => {
          const style = TRANSITION_STYLES[t.style]
          const Icon = t.icon
          return (
            <button
              key={t.to}
              onClick={() => statusMutation.mutate(t.to)}
              disabled={statusMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-85 disabled:opacity-50"
              style={{ background: style.bg, color: style.color, border: `1px solid ${style.border}` }}
            >
              {statusMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Icon className="w-4 h-4" />
              )}
              {t.label}
            </button>
          )
        })}

        {/* Divider */}
        {transitions.length > 0 && (
          <div className="w-px self-stretch" style={{ background: 'var(--border)' }} />
        )}

        {/* Quick actions */}
        <button
          onClick={() => scoreMutation.mutate()}
          disabled={scoreMutation.isPending || !job.jd_text}
          title={!job.jd_text ? 'No job description to score' : job.match_score != null ? 'Re-score this job with AI' : 'Score this job with AI'}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ borderColor: 'rgba(99,102,241,0.3)', color: 'var(--accent)', background: 'rgba(99,102,241,0.08)' }}
        >
          {scoreMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {job.match_score != null ? 'Re-score with AI' : 'Score with AI'}
        </button>
        {job.url && (
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all hover:opacity-80"
            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', background: 'var(--bg-card)' }}
          >
            <ExternalLink className="w-4 h-4" />
            View Posting
          </a>
        )}
        <Link
          to={`/resume?job=${job.id}`}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all hover:opacity-80"
          style={{ borderColor: 'var(--border)', color: 'var(--accent)', background: 'var(--bg-card)' }}
        >
          <FileText className="w-4 h-4" />
          {hasResume ? 'View Tailored Resume' : 'Tailor Resume'}
        </Link>

        {/* Dismiss / Restore */}
        <button
          onClick={() => dismissMutation.mutate()}
          disabled={dismissMutation.isPending}
          title={job.dismissed_at ? 'Restore this job to active views' : 'Hide this job from default views (reversible)'}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all hover:opacity-80 disabled:opacity-50 ml-auto"
          style={
            job.dismissed_at
              ? { borderColor: 'rgba(34,197,94,0.3)', color: 'var(--success)', background: 'rgba(34,197,94,0.08)' }
              : { borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-card)' }
          }
        >
          {dismissMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : job.dismissed_at ? (
            <RotateCcw className="w-4 h-4" />
          ) : (
            <EyeOff className="w-4 h-4" />
          )}
          {job.dismissed_at ? 'Restore' : 'Dismiss'}
        </button>
      </div>

      {/* Dismissed banner */}
      {job.dismissed_at && (
        <div
          className="flex items-center gap-2 px-4 py-3 rounded-lg border text-sm"
          style={{
            background: 'rgba(245,158,11,0.06)',
            borderColor: 'rgba(245,158,11,0.25)',
            color: 'var(--text-primary)',
          }}
        >
          <EyeOff className="w-4 h-4" style={{ color: 'var(--warning)' }} />
          <span>This job is dismissed and hidden from default views. Click <strong>Restore</strong> above to bring it back.</span>
        </div>
      )}

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: 2/3 width */}
        <div className="lg:col-span-2 space-y-6">
          {/* Recommended action */}
          {job.recommended_action && (
            <div
              className="rounded-xl p-5 border"
              style={{
                background: 'rgba(99,102,241,0.06)',
                borderColor: 'rgba(99,102,241,0.2)',
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
                  Recommended Action
                </h3>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                {job.recommended_action}
              </p>
            </div>
          )}

          {/* Cover letter */}
          {coverLetter && (
            <div
              className="rounded-xl border overflow-hidden"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              <div
                className="px-5 py-3 border-b flex items-center justify-between"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Cover Letter
                  </h3>
                </div>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
                  style={{
                    borderColor: copied ? 'rgba(34,197,94,0.3)' : 'var(--border)',
                    color: copied ? 'var(--success)' : 'var(--text-primary)',
                    background: copied ? 'rgba(34,197,94,0.08)' : 'var(--bg-secondary)',
                  }}
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <div
                className="px-5 py-4 text-sm leading-relaxed whitespace-pre-wrap"
                style={{ color: 'var(--text-primary)' }}
              >
                {coverLetter}
              </div>
            </div>
          )}

          {/* Research Notes */}
          <div
            className="rounded-xl border overflow-hidden"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          >
            <div
              className="px-5 py-3 border-b flex items-center justify-between"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Research Notes
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {notesSaved && (
                  <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--success)' }}>
                    <Check className="w-3.5 h-3.5" />
                    Saved
                  </span>
                )}
                {isEditingNotes ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setResearchNotes(job.research_notes || '')
                        setIsEditingNotes(false)
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => notesMutation.mutate(researchNotes)}
                      disabled={notesMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80 disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: '#fff' }}
                    >
                      {notesMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      Save
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsEditingNotes(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', background: 'var(--bg-secondary)' }}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    {researchNotes ? 'Edit' : 'Add Notes'}
                  </button>
                )}
              </div>
            </div>
            <div className="px-5 py-4">
              {isEditingNotes ? (
                <div className="space-y-2">
                  <textarea
                    value={researchNotes}
                    onChange={(e) => setResearchNotes(e.target.value)}
                    placeholder="Paste additional job details, company research, team info, tech stack details, or any context that will help tailor your resume better..."
                    rows={8}
                    className="w-full text-sm leading-relaxed rounded-lg border p-3 resize-y focus:outline-none focus:ring-2"
                    style={{
                      background: 'var(--bg-secondary)',
                      borderColor: 'var(--border)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    This context will be used alongside the job description when tailoring your resume and cover letter.
                  </p>
                </div>
              ) : researchNotes ? (
                <div
                  className="text-sm leading-relaxed whitespace-pre-wrap"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {researchNotes}
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  No research notes yet. Add extra context about this role — company details, team info, tech stack specifics — to get a better tailored resume.
                </p>
              )}
            </div>
          </div>

          {/* Job description — always visible, editable */}
          <div
            className="rounded-xl border overflow-hidden"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          >
            <div
              className="px-5 py-3 border-b flex items-center justify-between gap-2"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Job Description
                </h3>
                {!job.jd_text && !isEditingJd && (
                  <span
                    className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--warning)' }}
                  >
                    Missing
                  </span>
                )}
                {jdSaved && (
                  <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--success)' }}>
                    <Check className="w-3.5 h-3.5" />
                    Saved
                  </span>
                )}
              </div>
              {isEditingJd ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => { setJdDraft(job.jd_text ?? ''); setIsEditingJd(false) }}
                    disabled={jdMutation.isPending}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80 disabled:opacity-50"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => jdMutation.mutate(jdDraft)}
                    disabled={jdMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80 disabled:opacity-50"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >
                    {jdMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    Save
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setIsEditingJd(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', background: 'var(--bg-secondary)' }}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  {job.jd_text ? 'Edit' : 'Add JD'}
                </button>
              )}
            </div>
            <div className="px-5 py-4">
              {isEditingJd ? (
                <div className="space-y-2">
                  <textarea
                    value={jdDraft}
                    onChange={(e) => setJdDraft(e.target.value)}
                    placeholder="Paste the full job description here. After saving, click 'Score with AI' above and 'Tailor Resume' to use the new content."
                    rows={14}
                    className="w-full text-sm leading-relaxed rounded-lg border p-3 resize-y focus:outline-none whitespace-pre-wrap font-mono"
                    style={{
                      background: 'var(--bg-secondary)',
                      borderColor: 'var(--border)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Saving updates the JD only — re-run <strong>Score with AI</strong> to refresh the match score and keywords, then re-tailor your resume.
                  </p>
                </div>
              ) : job.jd_text ? (
                <div
                  className="text-sm leading-relaxed whitespace-pre-wrap max-h-[500px] overflow-y-auto"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {job.jd_text}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    This job has no description on record — the scraper didn't capture one. Without it the AI can't score the match or tailor a resume.
                  </p>
                  {job.url && (
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      Open the original posting via the <strong>View Posting</strong> button above, copy the JD, then click <strong>Add JD</strong> to paste it here.
                    </p>
                  )}
                  <button
                    onClick={() => setIsEditingJd(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Add Job Description
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column: 1/3 width */}
        <div className="space-y-6">
          {/* Match score card */}
          {job.match_score != null && (
            <div
              className="rounded-xl border p-5"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                Match Score
                <InfoTooltip text={TOOLTIPS.match} />
              </h3>
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="text-4xl font-extrabold"
                  style={{ color: scoreColor(job.match_score) }}
                >
                  {formatScore(job.match_score)}
                </div>
                <Target className="w-6 h-6" style={{ color: scoreColor(job.match_score) }} />
              </div>
              <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(job.match_score * 100, 100)}%`,
                    background: scoreColor(job.match_score),
                  }}
                />
              </div>
            </div>
          )}

          {/* Resume status card */}
          <div
            className="rounded-xl border p-5"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>
              Tailored Resume
            </h3>
            {hasResume ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" style={{ color: 'var(--success)' }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--success)' }}>Generated</span>
                </div>
                {resumeData?.ats_score != null && (
                  <div className="text-sm flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                    <span>Tailored ATS:</span>
                    <span className="font-medium" style={{ color: scoreColor(resumeData.ats_score) }}>{formatScore(resumeData.ats_score)}</span>
                    <InfoTooltip text={TOOLTIPS.tailoredAts} />
                  </div>
                )}
                {resumeData?.score_breakdown?.stats && (
                  <div className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
                    <div>
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {resumeData.score_breakdown.stats.matched_required_count} / {resumeData.score_breakdown.stats.required_count}
                      </span>{' '}required skills
                    </div>
                    <div>
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {resumeData.score_breakdown.stats.matched_preferred_count} / {resumeData.score_breakdown.stats.preferred_count}
                      </span>{' '}preferred skills
                    </div>
                  </div>
                )}
                {resumeData?.score_breakdown?.missing_required && resumeData.score_breakdown.missing_required.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: 'var(--danger)' }}>
                      Still missing
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {resumeData.score_breakdown.missing_required.slice(0, 5).map((kw: string, i: number) => (
                        <span
                          key={i}
                          className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                          style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }}
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <Link
                    to={`/resume?job=${job.id}`}
                    className="flex-1 text-center px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >
                    Open in Studio
                  </Link>
                  <a
                    href={`/api/resume/${job.id}/pdf?download=true`}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    PDF
                  </a>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  No tailored resume yet
                </p>
                <Link
                  to={`/resume?job=${job.id}`}
                  className="block text-center px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  Generate Resume
                </Link>
              </div>
            )}
          </div>

          {/* ATS Keywords */}
          {job.ats_keywords && job.ats_keywords.length > 0 && (
            <div
              className="rounded-xl border p-5"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Tag className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  ATS Keywords
                </h3>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {job.ats_keywords.map((kw: string, i: number) => (
                  <span
                    key={i}
                    className="text-xs px-2.5 py-1 rounded-full font-medium"
                    style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--accent)' }}
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ATS Gap Analysis */}
          {job.jd_text && (
            <div
              className="rounded-xl border p-5"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Target className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                <h3 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Keyword Gap
                  <InfoTooltip text={TOOLTIPS.keywordMatch} />
                </h3>
              </div>
              <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                Your master resume vs this JD
              </p>

              {gapLoading && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
                </div>
              )}

              {gapError && (
                <p className="text-xs" style={{ color: 'var(--danger)' }}>
                  Failed to load gap analysis.
                </p>
              )}

              {gapData && !gapLoading && (
                <div className="space-y-4">
                  {/* Score display */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        className="text-2xl font-extrabold"
                        style={{ color: scoreColor(gapData.ats_score) }}
                      >
                        {formatScore(gapData.ats_score)}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        Keyword Match
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(gapData.ats_score * 100, 100)}%`,
                          background: scoreColor(gapData.ats_score),
                        }}
                      />
                    </div>
                  </div>

                  {/* Required / Preferred breakdown */}
                  {gapData.stats && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg p-2.5" style={{ background: 'var(--bg-secondary)' }}>
                        <div className="text-[10px] uppercase tracking-wider font-medium mb-0.5" style={{ color: 'var(--text-secondary)' }}>
                          Required
                        </div>
                        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {gapData.stats.matched_required_count} / {gapData.stats.required_count}
                        </div>
                      </div>
                      <div className="rounded-lg p-2.5" style={{ background: 'var(--bg-secondary)' }}>
                        <div className="text-[10px] uppercase tracking-wider font-medium mb-0.5" style={{ color: 'var(--text-secondary)' }}>
                          Preferred
                        </div>
                        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {gapData.stats.matched_preferred_count} / {gapData.stats.preferred_count}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Missing required — high priority */}
                  {gapData.missing_required && gapData.missing_required.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--danger)' }}>
                        Missing required
                        <span className="text-[10px] font-normal opacity-70">— add these if you have them</span>
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {gapData.missing_required.map((kw: string, i: number) => (
                          <span
                            key={i}
                            className="text-xs px-2.5 py-1 rounded-full font-medium"
                            style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }}
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Missing preferred — nice-to-haves */}
                  {gapData.missing_preferred && gapData.missing_preferred.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-2" style={{ color: 'var(--warning)' }}>
                        Missing nice-to-haves
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {gapData.missing_preferred.slice(0, 8).map((kw: string, i: number) => (
                          <span
                            key={i}
                            className="text-xs px-2.5 py-1 rounded-full font-medium"
                            style={{ background: 'rgba(245,158,11,0.10)', color: 'var(--warning)' }}
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Matched (collapsible) */}
                  {gapData.matching && gapData.matching.length > 0 && (
                    <div>
                      <button
                        onClick={() => setShowMatching(!showMatching)}
                        className="flex items-center gap-1.5 text-xs font-medium mb-2 transition-colors hover:opacity-80"
                        style={{ color: 'var(--success)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                      >
                        <ChevronDown
                          className="w-3.5 h-3.5 transition-transform"
                          style={{ transform: showMatching ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                        />
                        {showMatching ? 'Hide' : 'Show'} {gapData.matching.length} matched
                      </button>
                      {showMatching && (
                        <div className="flex flex-wrap gap-1.5">
                          {gapData.matching.map((kw: string, i: number) => (
                            <span
                              key={i}
                              className="text-xs px-2.5 py-1 rounded-full font-medium"
                              style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--success)' }}
                            >
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Red flags */}
          {job.red_flags && job.red_flags.length > 0 && (
            <div
              className="rounded-xl border p-5"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--danger)' }} />
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--danger)' }}>
                  Red Flags
                </h3>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {job.red_flags.map((flag: string, i: number) => (
                  <span
                    key={i}
                    className="text-xs px-2.5 py-1 rounded-full font-medium"
                    style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }}
                  >
                    {flag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Timeline */}
          <div
            className="rounded-xl border p-5"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>
              Timeline
            </h3>
            <div className="space-y-2.5">
              {job.posted_at && (
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />
                  <span style={{ color: 'var(--text-secondary)' }}>Posted</span>
                  <span className="ml-auto text-xs" style={{ color: 'var(--text-secondary)' }}>{formatDate(job.posted_at)}</span>
                </div>
              )}
              {job.deadline && (
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full" style={{ background: new Date(job.deadline) < new Date() ? 'var(--danger)' : 'var(--warning)' }} />
                  <span style={{ color: 'var(--text-secondary)' }}>Deadline</span>
                  <span className="ml-auto text-xs" style={{ color: new Date(job.deadline) < new Date() ? 'var(--danger)' : 'var(--text-secondary)' }}>{formatDate(job.deadline)}</span>
                </div>
              )}
              {job.scraped_at && (
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full" style={{ background: '#94a3b8' }} />
                  <span style={{ color: 'var(--text-secondary)' }}>Scraped</span>
                  <span className="ml-auto text-xs" style={{ color: 'var(--text-secondary)' }}>{formatDate(job.scraped_at)}</span>
                </div>
              )}
              {job.applied_at && (
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full" style={{ background: '#3b82f6' }} />
                  <span style={{ color: 'var(--text-secondary)' }}>Applied</span>
                  <span className="ml-auto text-xs" style={{ color: 'var(--text-secondary)' }}>{formatDate(job.applied_at)}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <div className="w-2 h-2 rounded-full" style={{ background: statusInfo.color }} />
                <span style={{ color: 'var(--text-secondary)' }}>Current: {statusInfo.label}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
