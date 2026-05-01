import { useState, useRef, useCallback, useMemo, type DragEvent } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, RefreshCw, Download, ChevronDown, Sparkles, Target, AlertCircle, Eye, X, Upload, Loader2, Check, BarChart3, Lightbulb, ArrowRight, CheckCircle2, Info, Copy, Mail, ExternalLink, MapPin, Globe, Clock, ArrowUpRight, Send } from 'lucide-react'
import { fetchJobs, fetchJob, fetchMasterResume, fetchTailoredResume, tailorResume, uploadResume, saveMasterResume, fetchGapAnalysis, enhanceResume, applySuggestions } from '../api'

export default function ResumeStudio() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedJobId, setSelectedJobId] = useState<string>(searchParams.get('job') ?? '')
  const [showPreview, setShowPreview] = useState(false)

  // Resume upload state
  const [uploadDragOver, setUploadDragOver] = useState(false)
  const [uploadParsing, setUploadParsing] = useState(false)
  const [uploadParsed, setUploadParsed] = useState<any>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([])
  const [uploadSaving, setUploadSaving] = useState(false)
  const uploadFileRef = useRef<HTMLInputElement>(null)

  // Gap analysis state
  const [gapData, setGapData] = useState<any>(null)
  const [gapLoading, setGapLoading] = useState(false)
  const [gapError, setGapError] = useState<string | null>(null)
  const [selectedMissingSkills, setSelectedMissingSkills] = useState<Set<string>>(new Set())
  const [addingSkills, setAddingSkills] = useState(false)
  const [addSkillsSuccess, setAddSkillsSuccess] = useState(false)

  // AI Enhancement state
  const [enhanceData, setEnhanceData] = useState<any>(null)
  const [enhanceLoading, setEnhanceLoading] = useState(false)
  const [enhanceError, setEnhanceError] = useState<string | null>(null)
  const [acceptedBullets, setAcceptedBullets] = useState<Set<number>>(new Set())
  const [selectedEnhanceSkills, setSelectedEnhanceSkills] = useState<Set<string>>(new Set())
  const [acceptedSummary, setAcceptedSummary] = useState(false)
  const [applyingChanges, setApplyingChanges] = useState(false)
  const [applySuccess, setApplySuccess] = useState(false)
  const [coverLetterCopied, setCoverLetterCopied] = useState(false)

  const handleCopyCoverLetter = async () => {
    if (!coverLetter) return
    try {
      await navigator.clipboard.writeText(coverLetter)
      setCoverLetterCopied(true)
      setTimeout(() => setCoverLetterCopied(false), 2000)
    } catch {
      // Clipboard API may be unavailable in some contexts; ignore silently
    }
  }

  const { data: jobs } = useQuery({
    queryKey: ['jobs', 'studio'],
    queryFn: async () => {
      // Bump limit so older jobs can still be tailored when navigated to via
      // ?job=<id>. 1000 covers any realistic single-user DB.
      const res = await fetchJobs({ limit: '1000' })
      return res.jobs ?? []
    },
  })

  // Fallback fetch for the currently-selected job. Covers the case where the
  // URL points to an older or dismissed job that isn't in the dropdown's list,
  // so the context card and dropdown selection still render correctly.
  const { data: selectedJobFromApi } = useQuery({
    queryKey: ['job', selectedJobId],
    queryFn: () => fetchJob(selectedJobId),
    enabled: !!selectedJobId,
    staleTime: 30_000,
  })

  const { data: masterResume, isLoading: masterLoading } = useQuery({
    queryKey: ['masterResume'],
    queryFn: fetchMasterResume,
    retry: (failureCount, error: any) => {
      // Don't retry on 404
      if (error?.message?.includes('404')) return false
      return failureCount < 2
    },
  })

  // Upload handlers
  const handleUploadDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setUploadDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type === 'application/pdf') {
      processUploadFile(file)
    }
  }, [])

  const handleUploadFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      processUploadFile(file)
    }
  }

  const processUploadFile = async (file: File) => {
    setUploadParsing(true)
    setUploadParsed(null)
    setUploadError(null)
    setUploadWarnings([])
    try {
      const result = await uploadResume(file)
      setUploadParsed(result.parsed)
      setUploadWarnings(result.warnings ?? [])
    } catch (err: any) {
      setUploadError(err.message || 'Failed to parse resume')
    } finally {
      setUploadParsing(false)
    }
  }

  const handleSaveMasterResume = async () => {
    if (!uploadParsed) return
    setUploadSaving(true)
    try {
      await saveMasterResume(uploadParsed)
      queryClient.invalidateQueries({ queryKey: ['masterResume'] })
      queryClient.invalidateQueries({ queryKey: ['setup-status'] })
      setUploadParsed(null)
      setUploadError(null)
      setUploadWarnings([])
    } catch {
      // silently fail
    } finally {
      setUploadSaving(false)
    }
  }

  const resetUpload = () => {
    setUploadParsed(null)
    setUploadError(null)
    setUploadWarnings([])
    setUploadParsing(false)
    if (uploadFileRef.current) uploadFileRef.current.value = ''
  }

  // Gap analysis handlers
  const handleFetchGapAnalysis = async () => {
    setGapLoading(true)
    setGapError(null)
    setGapData(null)
    setSelectedMissingSkills(new Set())
    setAddSkillsSuccess(false)
    try {
      const result = await fetchGapAnalysis()
      setGapData(result)
    } catch (err: any) {
      setGapError(err.message || 'Failed to fetch gap analysis')
    } finally {
      setGapLoading(false)
    }
  }

  const toggleMissingSkill = (skill: string) => {
    setSelectedMissingSkills(prev => {
      const next = new Set(prev)
      if (next.has(skill)) {
        next.delete(skill)
      } else {
        next.add(skill)
      }
      return next
    })
  }

  const handleAddSelectedSkills = async () => {
    if (selectedMissingSkills.size === 0) return
    setAddingSkills(true)
    setAddSkillsSuccess(false)
    try {
      await applySuggestions({ add_skills: Array.from(selectedMissingSkills) })
      queryClient.invalidateQueries({ queryKey: ['masterResume'] })
      setAddSkillsSuccess(true)
      setSelectedMissingSkills(new Set())
      setTimeout(() => setAddSkillsSuccess(false), 3000)
    } catch {
      // fail silently
    } finally {
      setAddingSkills(false)
    }
  }

  // AI Enhancement handlers
  const handleEnhanceResume = async () => {
    setEnhanceLoading(true)
    setEnhanceError(null)
    setEnhanceData(null)
    setAcceptedBullets(new Set())
    setSelectedEnhanceSkills(new Set())
    setAcceptedSummary(false)
    setApplySuccess(false)
    try {
      const result = await enhanceResume()
      setEnhanceData(result)
      // Pre-select all enhance skills
      if (result.missing_skills_to_add?.length) {
        setSelectedEnhanceSkills(new Set(result.missing_skills_to_add.map((s: any) => s.skill ?? s.name ?? s)))
      }
    } catch (err: any) {
      setEnhanceError(err.message || 'Failed to get AI suggestions')
    } finally {
      setEnhanceLoading(false)
    }
  }

  const toggleAcceptBullet = (index: number) => {
    setAcceptedBullets(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const toggleEnhanceSkill = (skill: string) => {
    setSelectedEnhanceSkills(prev => {
      const next = new Set(prev)
      if (next.has(skill)) {
        next.delete(skill)
      } else {
        next.add(skill)
      }
      return next
    })
  }

  const handleApplyAcceptedChanges = async () => {
    setApplyingChanges(true)
    setApplySuccess(false)
    try {
      const payload: any = {}

      // Collect accepted bullet rewrites
      if (acceptedBullets.size > 0 && enhanceData?.bullet_rewrites) {
        payload.bullet_rewrites = enhanceData.bullet_rewrites.filter((_: any, i: number) => acceptedBullets.has(i))
      }

      // Collect selected skills
      if (selectedEnhanceSkills.size > 0) {
        payload.add_skills = Array.from(selectedEnhanceSkills)
      }

      // Collect accepted summary
      if (acceptedSummary && enhanceData?.summary_rewrite?.suggested) {
        payload.new_summary = enhanceData.summary_rewrite.suggested
      }

      await applySuggestions(payload)
      queryClient.invalidateQueries({ queryKey: ['masterResume'] })
      setApplySuccess(true)
      setTimeout(() => setApplySuccess(false), 3000)
    } catch {
      // fail silently
    } finally {
      setApplyingChanges(false)
    }
  }

  const hasAcceptedChanges = acceptedBullets.size > 0 || selectedEnhanceSkills.size > 0 || acceptedSummary

  // fetchTailoredResume returns { tailored: {...}, ats_score, pdf_path, docx_path }
  // but it throws on 404 (no tailored resume yet) — we catch that and return null
  const { data: tailoredData, isLoading: tailoredLoading } = useQuery({
    queryKey: ['tailoredResume', selectedJobId],
    queryFn: async () => {
      try {
        return await fetchTailoredResume(selectedJobId)
      } catch {
        return null
      }
    },
    enabled: !!selectedJobId,
  })

  const tailorMutation = useMutation({
    mutationFn: (jobId: string) => tailorResume(jobId),
    onSuccess: (data) => {
      // The POST response has the same shape — cache it directly
      queryClient.setQueryData(['tailoredResume', selectedJobId], data)
    },
  })

  // Keep URL in sync with selection
  const handleJobChange = (jobId: string) => {
    setSelectedJobId(jobId)
    if (jobId) {
      setSearchParams({ job: jobId })
    } else {
      setSearchParams({})
    }
  }

  const selectedJob =
    jobs?.find((j: any) => j.id === selectedJobId) ?? selectedJobFromApi ?? null

  // If the selected job isn't in the loaded list (older, dismissed, etc.), inject
  // it so the dropdown can render its <option> and not appear blank.
  const dropdownJobs = useMemo(() => {
    const base = jobs ?? []
    if (
      selectedJobId &&
      selectedJobFromApi &&
      !base.some((j: any) => j.id === selectedJobId)
    ) {
      return [selectedJobFromApi, ...base]
    }
    return base
  }, [jobs, selectedJobFromApi, selectedJobId])

  // Unwrap the nested structure: { tailored: { summary, experience, ... }, ats_score, ... }
  const tailored = tailoredData?.tailored ?? null
  const atsScore = tailoredData?.ats_score ?? null
  const coverLetter = tailoredData?.cover_letter ?? null
  const pdfPath = tailoredData?.pdf_path ?? null
  const hasTailored = tailored && (tailored.summary || tailored.experience?.length || tailored.skills)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Resume Studio
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Tailor your resume for each application
          </p>
        </div>
      </div>

      {/* Job selector */}
      <div
        className="rounded-xl p-5 border"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
      >
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
          Select a job to tailor your resume
        </label>
        <div className="relative">
          <select
            value={selectedJobId}
            onChange={(e) => handleJobChange(e.target.value)}
            className="w-full appearance-none rounded-lg px-4 py-3 pr-10 text-sm border outline-none transition-colors"
            style={{
              background: 'var(--bg-secondary)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="">-- Choose a job --</option>
            {dropdownJobs.map((job: any) => (
              <option key={job.id} value={job.id}>
                {job.company} — {job.title} ({job.match_score != null ? `${Math.round(job.match_score * 100)}%` : job.status})
              </option>
            ))}
          </select>
          <ChevronDown
            className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
            style={{ color: 'var(--text-secondary)' }}
          />
        </div>

        {/* Selected job context — quick-access info & links */}
        {selectedJob && (
          <div
            className="mt-4 rounded-lg border p-4"
            style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                    {selectedJob.title}
                  </h3>
                  {selectedJob.match_score != null && (
                    <span
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                      style={{
                        background: selectedJob.match_score >= 0.65
                          ? 'rgba(34,197,94,0.15)'
                          : selectedJob.match_score >= 0.4
                          ? 'rgba(245,158,11,0.15)'
                          : 'rgba(239,68,68,0.15)',
                        color: selectedJob.match_score >= 0.65
                          ? 'var(--success)'
                          : selectedJob.match_score >= 0.4
                          ? 'var(--warning)'
                          : 'var(--danger)',
                      }}
                    >
                      {Math.round(selectedJob.match_score * 100)}% match
                    </span>
                  )}
                </div>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {selectedJob.company}
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {selectedJob.location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {selectedJob.location}
                    </span>
                  )}
                  {selectedJob.source && (
                    <span className="inline-flex items-center gap-1">
                      <Globe className="w-3 h-3" />
                      {selectedJob.source}
                    </span>
                  )}
                  {selectedJob.deadline && (
                    <span
                      className="inline-flex items-center gap-1"
                      style={{ color: new Date(selectedJob.deadline) < new Date() ? 'var(--danger)' : 'var(--warning)' }}
                    >
                      <Clock className="w-3 h-3" />
                      Deadline {new Date(selectedJob.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              </div>

              {/* Action links */}
              <div className="flex flex-wrap items-center gap-2">
                {selectedJob.url && (
                  <a
                    href={selectedJob.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open the original job posting"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
                    style={{
                      borderColor: 'rgba(99,102,241,0.3)',
                      color: 'var(--accent)',
                      background: 'rgba(99,102,241,0.08)',
                    }}
                  >
                    <Send className="w-3.5 h-3.5" />
                    Apply on site
                    <ExternalLink className="w-3 h-3 opacity-70" />
                  </a>
                )}
                <Link
                  to={`/jobs/${selectedJob.id}`}
                  title="Open the full job detail page"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
                  style={{
                    borderColor: 'var(--border)',
                    color: 'var(--text-primary)',
                    background: 'var(--bg-card)',
                  }}
                >
                  <FileText className="w-3.5 h-3.5" />
                  Job details
                  <ArrowUpRight className="w-3 h-3 opacity-70" />
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error banner */}
      {tailorMutation.isError && (
        <div
          className="rounded-lg px-4 py-3 flex items-center gap-3 border"
          style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)', color: 'var(--danger)' }}
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <p className="text-sm">
            Failed to generate resume: {(tailorMutation.error as Error)?.message ?? 'Unknown error'}
          </p>
        </div>
      )}

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Master Resume */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <div
            className="px-5 py-4 border-b flex items-center justify-between"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Master Resume
              </h2>
            </div>
            {masterResume && (
              <button
                onClick={() => {
                  resetUpload()
                  // Trigger the hidden file input for re-upload
                  uploadFileRef.current?.click()
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
                style={{
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                  background: 'var(--bg-secondary)',
                }}
              >
                <Upload className="w-3.5 h-3.5" />
                Re-upload Resume
              </button>
            )}
          </div>
          <div className="p-5 space-y-5 max-h-[600px] overflow-y-auto">
            {/* Hidden file input for re-upload */}
            <input
              ref={uploadFileRef}
              type="file"
              accept=".pdf"
              onChange={handleUploadFileSelect}
              className="hidden"
            />

            {/* Show upload parsed preview overlay if actively uploading/parsed */}
            {(uploadParsing || uploadParsed || uploadError) && !masterLoading ? (
              <div className="space-y-4">
                {uploadParsing && (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin mb-3" style={{ color: 'var(--accent)' }} />
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      Parsing your resume with AI...
                    </p>
                  </div>
                )}

                {uploadError && (
                  <div>
                    <div
                      className="rounded-lg px-4 py-3 flex items-center gap-3 border"
                      style={{
                        background: 'rgba(239,68,68,0.08)',
                        borderColor: 'rgba(239,68,68,0.3)',
                        color: 'var(--danger)',
                      }}
                    >
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <p className="text-sm">{uploadError}</p>
                    </div>
                    <button
                      onClick={resetUpload}
                      className="mt-3 text-xs font-medium underline transition-opacity hover:opacity-70"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {uploadParsed && !uploadParsing && (
                  <div className="space-y-4">
                    <div
                      className="rounded-xl border p-5 space-y-3"
                      style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          Parsed Resume Preview
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Name</p>
                          <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
                            {uploadParsed.name || uploadParsed.contact?.name || '(not detected)'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Experience</p>
                          <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
                            {uploadParsed.experience?.length ?? 0} entries
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Skills</p>
                          <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
                            {(Array.isArray(uploadParsed.skills) ? uploadParsed.skills.length : Object.values(uploadParsed.skills || {}).flat().length) ?? 0} found
                          </p>
                        </div>
                      </div>

                      {/* Show summary if available */}
                      {uploadParsed.summary && (
                        <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                          <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Summary</p>
                          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                            {uploadParsed.summary}
                          </p>
                        </div>
                      )}
                    </div>

                    {uploadWarnings.length > 0 && (
                      <div
                        className="rounded-lg px-4 py-3 border text-sm space-y-1"
                        style={{
                          background: 'rgba(245, 158, 11, 0.08)',
                          borderColor: 'rgba(245, 158, 11, 0.3)',
                          color: 'var(--warning, #f59e0b)',
                        }}
                      >
                        <p className="font-medium">Warnings:</p>
                        <ul className="list-disc list-inside text-xs space-y-0.5">
                          {uploadWarnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleSaveMasterResume}
                        disabled={uploadSaving}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                        style={{
                          background: 'var(--accent)',
                          color: '#fff',
                          opacity: uploadSaving ? 0.6 : 1,
                        }}
                      >
                        {uploadSaving ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                        Save as Master Resume
                      </button>
                      <button
                        onClick={resetUpload}
                        className="text-xs font-medium underline transition-opacity hover:opacity-70"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : masterLoading ? (
              <LoadingSkeleton />
            ) : masterResume ? (
              <>
                {masterResume.summary && (
                  <ResumeSection title="Summary" content={masterResume.summary} />
                )}
                {masterResume.experience?.length > 0 && (
                  <div>
                    <h3
                      className="text-xs font-semibold uppercase tracking-wider mb-3"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Experience
                    </h3>
                    <ul className="space-y-4">
                      {masterResume.experience.map((exp: any, i: number) => (
                        <ExperienceBlock key={i} exp={exp} />
                      ))}
                    </ul>
                  </div>
                )}
                {masterResume.skills?.length > 0 && (
                  <div>
                    <h3
                      className="text-xs font-semibold uppercase tracking-wider mb-3"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Skills
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {masterResume.skills.map((skill: string, i: number) => (
                        <SkillChip key={i} label={skill} />
                      ))}
                    </div>
                  </div>
                )}
                {masterResume.education?.length > 0 && (
                  <div>
                    <h3
                      className="text-xs font-semibold uppercase tracking-wider mb-3"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Education
                    </h3>
                    {masterResume.education.map((edu: any, i: number) => (
                      <p key={i} className="text-sm" style={{ color: 'var(--text-primary)' }}>
                        {edu.degree ?? edu} {edu.institution && `— ${edu.institution}`} {edu.year && `(${edu.year})`}
                      </p>
                    ))}
                  </div>
                )}
              </>
            ) : (
              /* 404 / No master resume — show upload zone */
              <div className="space-y-4">
                <div
                  onDragOver={(e) => { e.preventDefault(); setUploadDragOver(true) }}
                  onDragLeave={() => setUploadDragOver(false)}
                  onDrop={handleUploadDrop}
                  onClick={() => uploadFileRef.current?.click()}
                  className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-12 px-6 cursor-pointer transition-all"
                  style={{
                    borderColor: uploadDragOver ? 'var(--accent)' : 'var(--border)',
                    background: uploadDragOver ? 'rgba(99, 102, 241, 0.05)' : 'var(--bg-secondary)',
                  }}
                >
                  <Upload className="w-8 h-8 mb-3" style={{ color: 'var(--text-secondary)' }} />
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    No master resume found
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Drag and drop a PDF resume here, or click to browse
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Tailored Resume */}
        <div
          className="rounded-xl border overflow-hidden"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
        >
          <div
            className="px-5 py-4 border-b flex items-center justify-between"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" style={{ color: 'var(--warning)' }} />
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Tailored Resume
                {selectedJob && (
                  <span className="ml-2 font-normal" style={{ color: 'var(--text-secondary)' }}>
                    for {selectedJob.company}
                  </span>
                )}
              </h2>
            </div>
            {selectedJobId && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => tailorMutation.mutate(selectedJobId)}
                  disabled={tailorMutation.isPending}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: 'var(--accent)',
                    color: '#fff',
                    opacity: tailorMutation.isPending ? 0.7 : 1,
                  }}
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${tailorMutation.isPending ? 'animate-spin' : ''}`}
                  />
                  {tailorMutation.isPending ? 'Tailoring...' : hasTailored ? 'Re-tailor' : 'Generate'}
                </button>
                {pdfPath && (
                  <>
                    <button
                      onClick={() => setShowPreview(true)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
                      style={{
                        borderColor: 'var(--border)',
                        color: 'var(--text-primary)',
                        background: 'var(--bg-secondary)',
                      }}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Preview
                    </button>
                    <a
                      href={`/api/resume/${selectedJobId}/pdf?download=true`}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
                      style={{
                        borderColor: 'var(--border)',
                        color: 'var(--text-primary)',
                        background: 'var(--bg-secondary)',
                      }}
                    >
                      <Download className="w-3.5 h-3.5" />
                      PDF
                    </a>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="p-5 space-y-5 max-h-[600px] overflow-y-auto">
            {!selectedJobId ? (
              <EmptyState message="Select a job above to view or generate a tailored resume." />
            ) : tailoredLoading || tailorMutation.isPending ? (
              <div className="space-y-4">
                <LoadingSkeleton />
                {tailorMutation.isPending && (
                  <p className="text-xs text-center" style={{ color: 'var(--text-secondary)' }}>
                    AI is tailoring your resume... this may take 15-30 seconds
                  </p>
                )}
              </div>
            ) : hasTailored ? (
              <>
                {/* ATS Score */}
                {atsScore !== null && (
                  <div className="flex items-center gap-4 mb-2">
                    <ATSScoreMeter score={atsScore} />
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        ATS Match Score
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {atsScore >= 0.8
                          ? 'Excellent match'
                          : atsScore >= 0.6
                          ? 'Good match'
                          : atsScore >= 0.3
                          ? 'Fair match — consider re-tailoring'
                          : 'Low match — re-tailor recommended'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Tailored summary */}
                {tailored.summary && (
                  <ResumeSection title="Summary" content={tailored.summary} />
                )}

                {/* Experience */}
                {tailored.experience?.length > 0 && (
                  <div>
                    <h3
                      className="text-xs font-semibold uppercase tracking-wider mb-3"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Experience
                    </h3>
                    <ul className="space-y-4">
                      {tailored.experience.map((exp: any, i: number) => (
                        <ExperienceBlock key={i} exp={exp} highlight />
                      ))}
                    </ul>
                  </div>
                )}

                {/* Skills (categorized dict or flat list) */}
                {tailored.skills && (
                  <div>
                    <h3
                      className="text-xs font-semibold uppercase tracking-wider mb-3"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Skills
                    </h3>
                    {typeof tailored.skills === 'object' && !Array.isArray(tailored.skills) ? (
                      <div className="space-y-3">
                        {Object.entries(tailored.skills).map(([category, items]: [string, any]) => (
                          <div key={category}>
                            <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                              {category}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {(items as string[]).map((skill: string, i: number) => (
                                <SkillChip key={i} label={skill} accent />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : Array.isArray(tailored.skills) && tailored.skills.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {tailored.skills.map((skill: string, i: number) => (
                          <SkillChip key={i} label={skill} accent />
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Projects */}
                {tailored.projects?.length > 0 && (
                  <div>
                    <h3
                      className="text-xs font-semibold uppercase tracking-wider mb-3"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Projects
                    </h3>
                    <ul className="space-y-2">
                      {tailored.projects.map((proj: any, i: number) => (
                        <li key={i} className="flex items-start gap-2">
                          <span
                            className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ background: 'var(--accent)' }}
                          />
                          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                            <span className="font-medium">{proj.name}</span>
                            {proj.description && ` — ${proj.description}`}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Cover letter */}
                {coverLetter && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3
                        className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <Mail className="w-3.5 h-3.5" />
                        Cover Letter
                      </h3>
                      <button
                        onClick={handleCopyCoverLetter}
                        title={coverLetterCopied ? 'Copied!' : 'Copy cover letter to clipboard'}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-all hover:opacity-80"
                        style={{
                          borderColor: coverLetterCopied ? 'rgba(34,197,94,0.3)' : 'var(--border)',
                          color: coverLetterCopied ? 'var(--success)' : 'var(--text-primary)',
                          background: coverLetterCopied ? 'rgba(34,197,94,0.08)' : 'var(--bg-secondary)',
                        }}
                      >
                        {coverLetterCopied ? (
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
                      className="rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap border"
                      style={{
                        color: 'var(--text-primary)',
                        background: 'var(--bg-secondary)',
                        borderColor: 'var(--border)',
                      }}
                    >
                      {coverLetter}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Target className="w-10 h-10 mb-4" style={{ color: 'var(--text-secondary)', opacity: 0.5 }} />
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                  No tailored resume yet
                </p>
                <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
                  Click below to generate a resume optimized for this job.
                </p>
                <button
                  onClick={() => tailorMutation.mutate(selectedJobId)}
                  disabled={tailorMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                  style={{
                    background: 'var(--accent)',
                    color: '#fff',
                    opacity: tailorMutation.isPending ? 0.7 : 1,
                  }}
                >
                  <Sparkles className={`w-4 h-4 ${tailorMutation.isPending ? 'animate-spin' : ''}`} />
                  {tailorMutation.isPending ? 'Generating...' : 'Generate Tailored Resume'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Resume Enhancement Section — full width below the two panels */}
      {masterResume && (
        <div className="space-y-6">
          {/* Section 1: Market Gap Analysis */}
          <div
            className="rounded-xl border overflow-hidden"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          >
            <div
              className="px-5 py-4 border-b flex items-center justify-between"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Market Gap Analysis
                </h2>
              </div>
              <button
                onClick={handleFetchGapAnalysis}
                disabled={gapLoading}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  opacity: gapLoading ? 0.7 : 1,
                }}
              >
                {gapLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <BarChart3 className="w-3.5 h-3.5" />
                )}
                {gapLoading ? 'Analyzing...' : gapData ? 'Re-analyze' : 'Analyze'}
              </button>
            </div>
            <div className="p-5">
              {gapError && (
                <div
                  className="rounded-lg px-4 py-3 flex items-center gap-3 border mb-4"
                  style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)', color: 'var(--danger)' }}
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <p className="text-sm">{gapError}</p>
                </div>
              )}

              {gapLoading && !gapData && (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin mb-3" style={{ color: 'var(--accent)' }} />
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    Analyzing job market trends against your resume...
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    This may take a moment
                  </p>
                </div>
              )}

              {!gapData && !gapLoading && !gapError && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <BarChart3 className="w-10 h-10 mb-3" style={{ color: 'var(--text-secondary)', opacity: 0.4 }} />
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Click "Analyze" to compare your resume against current job market demands.
                  </p>
                </div>
              )}

              {gapData && !gapLoading && (
                <div className="space-y-5">
                  {/* Jobs analyzed stat */}
                  <div
                    className="rounded-lg px-4 py-3 border flex items-center gap-3"
                    style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
                  >
                    <Info className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent)' }} />
                    <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                      Based on <span className="font-semibold">{gapData.total_jobs_analyzed ?? gapData.jobs_analyzed ?? 0}</span> jobs analyzed
                    </p>
                  </div>

                  {/* Missing high-demand skills */}
                  {gapData.missing_high_demand?.length > 0 && (
                    <div>
                      <h3
                        className="text-xs font-semibold uppercase tracking-wider mb-3"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Missing High-Demand Skills
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {[...gapData.missing_high_demand]
                          .sort((a: any, b: any) => (b.pct ?? b.percentage ?? 0) - (a.pct ?? a.percentage ?? 0))
                          .map((skill: any, i: number) => {
                            const name = skill.keyword ?? skill.skill ?? skill
                            const pct = skill.pct ?? skill.percentage ?? null
                            const isSelected = selectedMissingSkills.has(name)
                            return (
                              <button
                                key={i}
                                onClick={() => toggleMissingSkill(name)}
                                className="px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer"
                                style={{
                                  background: isSelected ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.08)',
                                  color: 'var(--danger)',
                                  border: `1.5px solid ${isSelected ? 'var(--danger)' : 'rgba(239,68,68,0.3)'}`,
                                  boxShadow: isSelected ? '0 0 0 1px var(--danger)' : 'none',
                                }}
                              >
                                {name}{pct !== null ? ` ${Math.round(pct * 100)}%` : ''}
                                {isSelected && <Check className="w-3 h-3 inline-block ml-1" />}
                              </button>
                            )
                          })}
                      </div>
                    </div>
                  )}

                  {/* Matching skills */}
                  {gapData.present_high_demand?.length > 0 && (
                    <div>
                      <h3
                        className="text-xs font-semibold uppercase tracking-wider mb-3"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Your Matching Skills
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {gapData.present_high_demand.map((skill: any, i: number) => {
                          const name = skill.keyword ?? skill.skill ?? skill
                          const pct = skill.pct ?? skill.percentage ?? null
                          return (
                            <span
                              key={i}
                              className="px-2.5 py-1 rounded-md text-xs font-medium"
                              style={{
                                background: 'rgba(34,197,94,0.1)',
                                color: 'var(--success)',
                                border: '1px solid rgba(34,197,94,0.3)',
                              }}
                            >
                              {name}{pct !== null ? ` ${Math.round(pct * 100)}%` : ''}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Add Selected to Resume button */}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={handleAddSelectedSkills}
                      disabled={selectedMissingSkills.size === 0 || addingSkills}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                      style={{
                        background: selectedMissingSkills.size > 0 ? 'var(--accent)' : 'var(--bg-secondary)',
                        color: selectedMissingSkills.size > 0 ? '#fff' : 'var(--text-secondary)',
                        opacity: addingSkills ? 0.7 : 1,
                        cursor: selectedMissingSkills.size === 0 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {addingSkills ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      Add Selected to Resume
                      {selectedMissingSkills.size > 0 && (
                        <span
                          className="ml-1 px-1.5 py-0.5 rounded text-xs"
                          style={{ background: 'rgba(255,255,255,0.2)' }}
                        >
                          {selectedMissingSkills.size}
                        </span>
                      )}
                    </button>

                    {addSkillsSuccess && (
                      <span className="flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--success)' }}>
                        <CheckCircle2 className="w-4 h-4" />
                        Skills added successfully
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section 2: AI Enhancement Suggestions */}
          <div
            className="rounded-xl border overflow-hidden"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          >
            <div
              className="px-5 py-4 border-b flex items-center justify-between"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4" style={{ color: 'var(--warning)' }} />
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  AI Enhancement Suggestions
                </h2>
              </div>
              <button
                onClick={handleEnhanceResume}
                disabled={enhanceLoading}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  opacity: enhanceLoading ? 0.7 : 1,
                }}
              >
                {enhanceLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {enhanceLoading ? 'Analyzing...' : enhanceData ? 'Refresh Suggestions' : 'Get AI Suggestions'}
              </button>
            </div>
            <div className="p-5">
              {enhanceError && (
                <div
                  className="rounded-lg px-4 py-3 flex items-center gap-3 border mb-4"
                  style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)', color: 'var(--danger)' }}
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <p className="text-sm">{enhanceError}</p>
                </div>
              )}

              {enhanceLoading && !enhanceData && (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin mb-3" style={{ color: 'var(--accent)' }} />
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    AI is analyzing your resume for improvements...
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    This may take 15-30 seconds
                  </p>
                </div>
              )}

              {!enhanceData && !enhanceLoading && !enhanceError && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Lightbulb className="w-10 h-10 mb-3" style={{ color: 'var(--text-secondary)', opacity: 0.4 }} />
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Click "Get AI Suggestions" to receive personalized recommendations for improving your resume.
                  </p>
                </div>
              )}

              {enhanceData && !enhanceLoading && (
                <div className="space-y-6">
                  {/* a) Bullet Rewrites */}
                  {enhanceData.bullet_rewrites?.length > 0 && (
                    <div>
                      <h3
                        className="text-xs font-semibold uppercase tracking-wider mb-3"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Bullet Rewrites
                      </h3>
                      <div className="space-y-3">
                        {enhanceData.bullet_rewrites.map((item: any, i: number) => {
                          const isAccepted = acceptedBullets.has(i)
                          return (
                            <div
                              key={i}
                              className="rounded-lg border p-4 space-y-3"
                              style={{
                                borderColor: isAccepted ? 'rgba(34,197,94,0.4)' : 'var(--border)',
                                background: isAccepted ? 'rgba(34,197,94,0.04)' : 'var(--bg-secondary)',
                              }}
                            >
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {/* Original */}
                                <div>
                                  <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Original</p>
                                  <p
                                    className="text-sm leading-relaxed"
                                    style={{ color: 'var(--text-secondary)', opacity: 0.7 }}
                                  >
                                    {item.original}
                                  </p>
                                </div>
                                {/* Suggested */}
                                <div>
                                  <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>Suggested</p>
                                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                                    {item.suggested}
                                  </p>
                                </div>
                              </div>
                              {item.reason && (
                                <p className="text-xs italic" style={{ color: 'var(--text-secondary)' }}>
                                  {item.reason}
                                </p>
                              )}
                              <button
                                onClick={() => toggleAcceptBullet(i)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                                style={{
                                  background: isAccepted ? 'rgba(34,197,94,0.15)' : 'var(--bg-card)',
                                  color: isAccepted ? 'var(--success)' : 'var(--text-primary)',
                                  border: `1px solid ${isAccepted ? 'rgba(34,197,94,0.4)' : 'var(--border)'}`,
                                }}
                              >
                                {isAccepted ? (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Accepted
                                  </>
                                ) : (
                                  <>
                                    <Check className="w-3.5 h-3.5" />
                                    Accept
                                  </>
                                )}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* b) Skills to Add */}
                  {enhanceData.missing_skills_to_add?.length > 0 && (
                    <div>
                      <h3
                        className="text-xs font-semibold uppercase tracking-wider mb-3"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Skills to Add
                      </h3>
                      <div className="space-y-2">
                        {enhanceData.missing_skills_to_add.map((item: any, i: number) => {
                          const skillName = item.skill ?? item.name ?? item
                          const reason = item.reason ?? ''
                          const confidence = item.confidence ?? 'medium'
                          const isSelected = selectedEnhanceSkills.has(skillName)
                          const confColor = confidence === 'high'
                            ? 'var(--success)'
                            : confidence === 'medium'
                            ? 'var(--warning)'
                            : 'var(--text-secondary)'
                          const confBg = confidence === 'high'
                            ? 'rgba(34,197,94,0.12)'
                            : confidence === 'medium'
                            ? 'rgba(245,158,11,0.12)'
                            : 'var(--bg-secondary)'

                          return (
                            <label
                              key={i}
                              className="flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-all"
                              style={{
                                borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                                background: isSelected ? 'rgba(99,102,241,0.04)' : 'var(--bg-secondary)',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleEnhanceSkill(skillName)}
                                className="rounded"
                                style={{ accentColor: 'var(--accent)' }}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {skillName}
                                  </span>
                                  <span
                                    className="px-2 py-0.5 rounded text-xs font-medium"
                                    style={{ background: confBg, color: confColor }}
                                  >
                                    {confidence}
                                  </span>
                                </div>
                                {reason && (
                                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                                    {reason}
                                  </p>
                                )}
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* c) Summary Rewrite */}
                  {enhanceData.summary_rewrite && (
                    <div>
                      <h3
                        className="text-xs font-semibold uppercase tracking-wider mb-3"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Summary Rewrite
                      </h3>
                      <div
                        className="rounded-lg border p-4 space-y-3"
                        style={{
                          borderColor: acceptedSummary ? 'rgba(34,197,94,0.4)' : 'var(--border)',
                          background: acceptedSummary ? 'rgba(34,197,94,0.04)' : 'var(--bg-secondary)',
                        }}
                      >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Original</p>
                            <p
                              className="text-sm leading-relaxed"
                              style={{ color: 'var(--text-secondary)', opacity: 0.7 }}
                            >
                              {enhanceData.summary_rewrite.original}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>Suggested</p>
                            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                              {enhanceData.summary_rewrite.suggested}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => setAcceptedSummary(!acceptedSummary)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                          style={{
                            background: acceptedSummary ? 'rgba(34,197,94,0.15)' : 'var(--bg-card)',
                            color: acceptedSummary ? 'var(--success)' : 'var(--text-primary)',
                            border: `1px solid ${acceptedSummary ? 'rgba(34,197,94,0.4)' : 'var(--border)'}`,
                          }}
                        >
                          {acceptedSummary ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Accepted
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              Accept
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* d) General Tips */}
                  {enhanceData.tips?.length > 0 && (
                    <div>
                      <h3
                        className="text-xs font-semibold uppercase tracking-wider mb-3"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        General Tips
                      </h3>
                      <ul className="space-y-2">
                        {enhanceData.tips.map((tip: string, i: number) => (
                          <li key={i} className="flex items-start gap-2">
                            <ArrowRight
                              className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
                              style={{ color: 'var(--accent)' }}
                            />
                            <span className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                              {tip}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* e) Apply Accepted Changes button */}
                  <div
                    className="flex items-center gap-3 pt-3 border-t"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <button
                      onClick={handleApplyAcceptedChanges}
                      disabled={!hasAcceptedChanges || applyingChanges}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                      style={{
                        background: hasAcceptedChanges ? 'var(--accent)' : 'var(--bg-secondary)',
                        color: hasAcceptedChanges ? '#fff' : 'var(--text-secondary)',
                        opacity: applyingChanges ? 0.7 : 1,
                        cursor: !hasAcceptedChanges ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {applyingChanges ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      Apply Accepted Changes
                      {hasAcceptedChanges && (
                        <span
                          className="ml-1 px-1.5 py-0.5 rounded text-xs"
                          style={{ background: 'rgba(255,255,255,0.2)' }}
                        >
                          {acceptedBullets.size + selectedEnhanceSkills.size + (acceptedSummary ? 1 : 0)}
                        </span>
                      )}
                    </button>

                    {applySuccess && (
                      <span className="flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--success)' }}>
                        <CheckCircle2 className="w-4 h-4" />
                        Changes applied successfully
                      </span>
                    )}

                    {!hasAcceptedChanges && enhanceData && (
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        Accept at least one suggestion to apply changes
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PDF Preview Modal */}
      {showPreview && pdfPath && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setShowPreview(false)}
          />
          {/* Modal */}
          <div
            className="relative z-10 w-full max-w-4xl mx-4 rounded-xl border overflow-hidden flex flex-col"
            style={{
              background: 'var(--bg-card)',
              borderColor: 'var(--border)',
              height: '90vh',
            }}
          >
            {/* Modal header */}
            <div
              className="flex items-center justify-between px-5 py-3 border-b"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Resume Preview
                  {selectedJob && (
                    <span className="ml-2 font-normal" style={{ color: 'var(--text-secondary)' }}>
                      — {selectedJob.company} / {selectedJob.title}
                    </span>
                  )}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/resume/${selectedJobId}/pdf?download=true`}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
                  style={{
                    borderColor: 'var(--border)',
                    color: 'var(--text-primary)',
                    background: 'var(--bg-secondary)',
                  }}
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </a>
                <button
                  onClick={() => setShowPreview(false)}
                  className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            {/* PDF embed */}
            <div className="flex-1 min-h-0">
              <iframe
                src={`/api/resume/${selectedJobId}/pdf`}
                className="w-full h-full"
                title="Resume Preview"
                style={{ border: 'none', background: '#fff' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- Sub-components ---------- */

function ExperienceBlock({ exp, highlight }: { exp: any; highlight?: boolean }) {
  if (typeof exp === 'string') {
    return <BulletItem text={exp} highlight={highlight} />
  }
  const role = exp.role ?? exp.title ?? ''
  const company = exp.company ?? ''
  const start = exp.start_date ?? ''
  const end = exp.end_date ?? ''
  const dateRange = start ? ` (${start}${end ? ` - ${end}` : ''})` : ''

  // Bullets can be strings or objects with {text, tags}
  const bullets: string[] = (exp.bullets ?? []).map((b: any) =>
    typeof b === 'string' ? b : b.text ?? b.bullet ?? ''
  ).filter(Boolean)

  return (
    <div className="space-y-1">
      {(role || company) && (
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {role}{role && company ? ' at ' : ''}{company}
          {dateRange && (
            <span className="font-normal" style={{ color: 'var(--text-secondary)' }}>{dateRange}</span>
          )}
        </p>
      )}
      {bullets.map((b: string, j: number) => (
        <BulletItem key={j} text={b} highlight={highlight} />
      ))}
    </div>
  )
}

function ATSScoreMeter({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const radius = 30
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score * circumference)
  const color = score >= 0.8 ? 'var(--success)' : score >= 0.6 ? 'var(--warning)' : 'var(--danger)'

  return (
    <div className="relative" style={{ width: 72, height: 72 }}>
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth="5"
        />
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center text-sm font-bold"
        style={{ color }}
      >
        {pct}%
      </div>
    </div>
  )
}

function ResumeSection({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <h3
        className="text-xs font-semibold uppercase tracking-wider mb-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        {title}
      </h3>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
        {content}
      </p>
    </div>
  )
}

function BulletItem({ text, highlight }: { text: string; highlight?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: highlight ? 'var(--accent)' : 'var(--text-secondary)' }}
      />
      <span className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
        {text}
      </span>
    </li>
  )
}

function SkillChip({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span
      className="px-2.5 py-1 rounded-md text-xs font-medium"
      style={{
        background: accent ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-secondary)',
        color: accent ? 'var(--accent)' : 'var(--text-primary)',
        border: `1px solid ${accent ? 'rgba(99, 102, 241, 0.3)' : 'var(--border)'}`,
      }}
    >
      {label}
    </span>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {[1, 2, 3].map((n) => (
        <div key={n}>
          <div
            className="h-3 w-24 rounded mb-2"
            style={{ background: 'var(--border)' }}
          />
          <div className="space-y-2">
            <div className="h-3 rounded" style={{ background: 'var(--border)', width: '100%' }} />
            <div className="h-3 rounded" style={{ background: 'var(--border)', width: '80%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <FileText className="w-10 h-10 mb-3" style={{ color: 'var(--text-secondary)', opacity: 0.4 }} />
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {message}
      </p>
    </div>
  )
}
