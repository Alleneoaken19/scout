import { useState, useRef, useCallback, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Radar,
  ArrowRight,
  ArrowLeft,
  Check,
  Loader2,
  AlertCircle,
  ShieldCheck,
  Upload,
  FileText,
} from 'lucide-react'
import {
  validateApiKey,
  saveSettings,
  uploadResume,
  saveMasterResume,
  savePreferences,
} from '../api'

const STEPS = ['Welcome', 'AI Provider', 'Resume', 'Preferences', 'Done']

const PROVIDER_CHOICES = [
  { value: 'gemini', label: 'Google Gemini', desc: 'Free, good quality', keyUrl: 'https://aistudio.google.com/app/apikey' },
  { value: 'ollama', label: 'Ollama', desc: 'Free, runs locally', keyUrl: '' },
  { value: 'anthropic', label: 'Anthropic Claude', desc: 'Paid (~$5/mo), best quality', keyUrl: 'https://console.anthropic.com/settings/keys' },
]
const EXPERIENCE_LEVELS = ['junior', 'mid', 'senior', 'staff', 'lead']
const REMOTE_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'remote_first', label: 'Remote First' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'on_site', label: 'On-site' },
]

export default function SetupWizard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(0)

  // Step 2 - AI Provider
  const [selectedProvider, setSelectedProvider] = useState('gemini')
  const [apiKey, setApiKey] = useState('')
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string } | null>(null)
  const [, setKeySaved] = useState(false)
  const [keySaving, setKeySaving] = useState(false)

  // Step 3 - Resume
  const [, setResumeFile] = useState<File | null>(null)
  const [resumeParsing, setResumeParsing] = useState(false)
  const [resumeParsed, setResumeParsed] = useState<any>(null)
  const [resumeWarnings, setResumeWarnings] = useState<string[]>([])
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [, setResumeSaved] = useState(false)
  const [resumeSaving, setResumeSaving] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step 4 - Preferences
  const [jobTitlesInput, setJobTitlesInput] = useState('')
  const [locationsInput, setLocationsInput] = useState('')
  const [experienceLevels, setExperienceLevels] = useState<string[]>([])
  const [remotePreference, setRemotePreference] = useState('any')
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [, setPrefsSaved] = useState(false)

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))
  const back = () => setStep((s) => Math.max(s - 1, 0))

  const handleSkipSetup = () => {
    localStorage.setItem('scout_setup_dismissed', 'true')
    navigate('/dashboard')
  }

  // --- Step 2 handlers ---
  const handleValidateKey = async () => {
    setValidating(true)
    setValidationResult(null)
    try {
      const result = await validateApiKey(apiKey.trim() || '', selectedProvider)
      setValidationResult(result)
    } catch (err: any) {
      setValidationResult({ valid: false, error: err.message || 'Validation request failed' })
    } finally {
      setValidating(false)
    }
  }

  const handleSaveKey = async () => {
    setKeySaving(true)
    try {
      const payload: Record<string, string> = {
        ai_provider: selectedProvider,
      }
      if (selectedProvider !== 'ollama') {
        payload.ai_api_key = apiKey.trim()
      }
      // Set default model per provider
      if (selectedProvider === 'gemini') payload.ai_model = 'gemini-2.0-flash'
      else if (selectedProvider === 'ollama') payload.ai_model = 'llama3.2'
      else if (selectedProvider === 'anthropic') {
        payload.ai_model = 'claude-haiku-4-5-20251001'
        payload.anthropic_api_key = apiKey.trim()
        payload.anthropic_model = 'claude-haiku-4-5-20251001'
      }
      await saveSettings(payload)
      setKeySaved(true)
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['setup-status'] })
      next()
    } catch {
      // silently proceed
    } finally {
      setKeySaving(false)
    }
  }

  // --- Step 3 handlers ---
  const handleFileDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type === 'application/pdf') {
      processResumeFile(file)
    }
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      processResumeFile(file)
    }
  }

  const processResumeFile = async (file: File) => {
    setResumeFile(file)
    setResumeParsing(true)
    setResumeParsed(null)
    setResumeError(null)
    setResumeWarnings([])
    setResumeSaved(false)
    try {
      const result = await uploadResume(file)
      setResumeParsed(result.parsed)
      setResumeWarnings(result.warnings ?? [])
    } catch (err: any) {
      setResumeError(err.message || 'Failed to parse resume')
    } finally {
      setResumeParsing(false)
    }
  }

  const handleSaveResume = async () => {
    if (!resumeParsed) return
    setResumeSaving(true)
    try {
      await saveMasterResume(resumeParsed)
      setResumeSaved(true)
      queryClient.invalidateQueries({ queryKey: ['masterResume'] })
      queryClient.invalidateQueries({ queryKey: ['setup-status'] })
      next()
    } catch {
      // silently fail
    } finally {
      setResumeSaving(false)
    }
  }

  // --- Step 4 handlers ---
  const handleSavePreferences = async () => {
    setPrefsSaving(true)
    try {
      const titles = jobTitlesInput.split(',').map((s) => s.trim()).filter(Boolean)
      const locs = locationsInput.split(',').map((s) => s.trim()).filter(Boolean)
      await savePreferences({
        job_titles: titles,
        locations: locs,
        experience_levels: experienceLevels,
        remote_preference: remotePreference,
      })
      setPrefsSaved(true)
      queryClient.invalidateQueries({ queryKey: ['preferences'] })
      queryClient.invalidateQueries({ queryKey: ['setup-status'] })
      next()
    } catch {
      // silently fail
    } finally {
      setPrefsSaving(false)
    }
  }

  const toggleLevel = (level: string) => {
    setExperienceLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    )
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* Skip setup link */}
      <div className="absolute top-6 right-6">
        <button
          onClick={handleSkipSetup}
          className="text-xs font-medium underline transition-opacity hover:opacity-70"
          style={{ color: 'var(--text-secondary)' }}
        >
          Skip setup
        </button>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all"
              style={{
                background: i < step ? 'var(--success)' : i === step ? 'var(--accent)' : 'var(--bg-secondary)',
                color: i <= step ? '#fff' : 'var(--text-secondary)',
                border: i > step ? '1px solid var(--border)' : 'none',
              }}
            >
              {i < step ? <Check className="w-4 h-4" /> : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div
                className="w-8 h-0.5 rounded"
                style={{ background: i < step ? 'var(--success)' : 'var(--border)' }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Card */}
      <div
        className="w-full max-w-xl rounded-xl border p-8"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
      >
        {/* Step 1 - Welcome */}
        {step === 0 && (
          <div className="text-center space-y-6">
            <div className="flex justify-center">
              <Radar className="w-12 h-12" style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Welcome to Scout
              </h1>
              <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                Let's get you set up in 3 steps
              </p>
            </div>
            <button
              onClick={next}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium transition-all"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Get Started
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Step 2 - AI Provider */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                AI Provider
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                Scout uses AI to analyze jobs and tailor your resume. Choose a provider.
              </p>
            </div>

            {/* Provider selection */}
            <div className="grid gap-3">
              {PROVIDER_CHOICES.map((p) => (
                <button
                  key={p.value}
                  onClick={() => { setSelectedProvider(p.value); setValidationResult(null); setApiKey('') }}
                  className="flex items-center gap-3 p-4 rounded-xl border text-left transition-all"
                  style={{
                    background: selectedProvider === p.value ? 'var(--accent-subtle, rgba(59,130,246,0.1))' : 'var(--bg-card)',
                    borderColor: selectedProvider === p.value ? 'var(--accent)' : 'var(--border)',
                  }}
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{p.label}</div>
                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{p.desc}</div>
                  </div>
                  {selectedProvider === p.value && <Check className="w-5 h-5" style={{ color: 'var(--accent)' }} />}
                </button>
              ))}
            </div>

            {/* API Key input (not for Ollama) */}
            {selectedProvider !== 'ollama' && (
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value)
                    setValidationResult(null)
                    setKeySaved(false)
                  }}
                  placeholder="Paste your API key..."
                  className="w-full rounded-lg px-4 py-2.5 text-sm border outline-none transition-colors"
                  style={{
                    background: 'var(--bg-secondary)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-primary)',
                  }}
                />
                {PROVIDER_CHOICES.find(p => p.value === selectedProvider)?.keyUrl && (
                  <a
                    href={PROVIDER_CHOICES.find(p => p.value === selectedProvider)?.keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-xs mt-2 underline transition-opacity hover:opacity-70"
                    style={{ color: 'var(--accent)' }}
                  >
                    Get your free API key
                  </a>
                )}
              </div>
            )}

            {selectedProvider === 'ollama' && (
              <div className="p-4 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Ollama runs on your machine — no API key needed. Make sure it's installed and running.
                </p>
              </div>
            )}

            {/* Validate button */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleValidateKey}
                disabled={validating || !apiKey.trim()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
                style={{
                  background: 'var(--bg-secondary)',
                  color: !apiKey.trim() ? 'var(--text-secondary)' : 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  opacity: validating || !apiKey.trim() ? 0.6 : 1,
                  cursor: validating || !apiKey.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {validating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                Validate
              </button>
            </div>

            {/* Validation result */}
            {validationResult && (
              <div
                className="flex items-center gap-2 text-sm font-medium"
                style={{ color: validationResult.valid ? 'var(--success)' : 'var(--danger)' }}
              >
                {validationResult.valid ? (
                  <>
                    <Check className="w-4 h-4" />
                    API key is valid
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4" />
                    {validationResult.error || 'Invalid API key'}
                  </>
                )}
              </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={back}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ color: 'var(--text-secondary)' }}
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={next}
                  className="text-xs font-medium underline transition-opacity hover:opacity-70"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Skip
                </button>
                <button
                  onClick={handleSaveKey}
                  disabled={!apiKey.trim() || keySaving}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all"
                  style={{
                    background: 'var(--accent)',
                    color: '#fff',
                    opacity: !apiKey.trim() || keySaving ? 0.6 : 1,
                    cursor: !apiKey.trim() || keySaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {keySaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Save & Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3 - Resume */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Upload Your Resume
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                We'll parse your PDF resume with AI to create your master profile.
              </p>
            </div>

            {/* Drop zone */}
            {!resumeParsing && !resumeParsed && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-12 px-6 cursor-pointer transition-all"
                style={{
                  borderColor: dragOver ? 'var(--accent)' : 'var(--border)',
                  background: dragOver ? 'rgba(99, 102, 241, 0.05)' : 'var(--bg-secondary)',
                }}
              >
                <Upload className="w-8 h-8 mb-3" style={{ color: 'var(--text-secondary)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Drag and drop your PDF resume here
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  or click to browse files (.pdf)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            )}

            {/* Parsing spinner */}
            {resumeParsing && (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin mb-3" style={{ color: 'var(--accent)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Parsing your resume with AI...
                </p>
              </div>
            )}

            {/* Parse error */}
            {resumeError && (
              <div
                className="rounded-lg px-4 py-3 flex items-center gap-3 border"
                style={{
                  background: 'rgba(239,68,68,0.08)',
                  borderColor: 'rgba(239,68,68,0.3)',
                  color: 'var(--danger)',
                }}
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <p className="text-sm">{resumeError}</p>
              </div>
            )}

            {/* Parsed summary */}
            {resumeParsed && !resumeParsing && (
              <div className="space-y-4">
                <div
                  className="rounded-xl border p-5 space-y-3"
                  style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Parsed Resume Summary
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <SummaryItem
                      label="Name"
                      value={resumeParsed.name || resumeParsed.contact?.name || '(not detected)'}
                    />
                    <SummaryItem
                      label="Experience"
                      value={`${resumeParsed.experience?.length ?? 0} entries`}
                    />
                    <SummaryItem
                      label="Skills"
                      value={`${(Array.isArray(resumeParsed.skills) ? resumeParsed.skills.length : Object.values(resumeParsed.skills || {}).flat().length) ?? 0} found`}
                    />
                  </div>
                </div>

                {resumeWarnings.length > 0 && (
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
                      {resumeWarnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  onClick={() => {
                    setResumeFile(null)
                    setResumeParsed(null)
                    setResumeError(null)
                    setResumeWarnings([])
                    setResumeSaved(false)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                  className="text-xs font-medium underline transition-opacity hover:opacity-70"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Re-upload Resume
                </button>
              </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={back}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ color: 'var(--text-secondary)' }}
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={next}
                  className="text-xs font-medium underline transition-opacity hover:opacity-70"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Skip
                </button>
                {resumeParsed && (
                  <button
                    onClick={handleSaveResume}
                    disabled={resumeSaving}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all"
                    style={{
                      background: 'var(--accent)',
                      color: '#fff',
                      opacity: resumeSaving ? 0.6 : 1,
                    }}
                  >
                    {resumeSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    Save Resume
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 4 - Preferences */}
        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Job Preferences
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                Tell us what kind of roles you're looking for.
              </p>
            </div>

            {/* Job Titles */}
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                Job Titles
              </label>
              <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                Separate multiple titles with commas
              </p>
              <input
                type="text"
                value={jobTitlesInput}
                onChange={(e) => setJobTitlesInput(e.target.value)}
                placeholder="e.g. Software Engineer, Frontend Developer"
                className="w-full rounded-lg px-4 py-2.5 text-sm border outline-none transition-colors"
                style={{
                  background: 'var(--bg-secondary)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            {/* Locations */}
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                Locations
              </label>
              <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                Separate multiple locations with commas
              </p>
              <input
                type="text"
                value={locationsInput}
                onChange={(e) => setLocationsInput(e.target.value)}
                placeholder="e.g. San Francisco, New York, Remote"
                className="w-full rounded-lg px-4 py-2.5 text-sm border outline-none transition-colors"
                style={{
                  background: 'var(--bg-secondary)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            {/* Experience Levels */}
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                Experience Level
              </label>
              <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                Select all that apply
              </p>
              <div className="flex flex-wrap gap-2">
                {EXPERIENCE_LEVELS.map((level) => {
                  const active = experienceLevels.includes(level)
                  return (
                    <button
                      key={level}
                      onClick={() => toggleLevel(level)}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-medium capitalize transition-all"
                      style={{
                        background: active ? 'var(--accent)' : 'var(--bg-secondary)',
                        color: active ? '#fff' : 'var(--text-secondary)',
                        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      }}
                    >
                      {level}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Remote Preference */}
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                Remote Preference
              </label>
              <select
                value={remotePreference}
                onChange={(e) => setRemotePreference(e.target.value)}
                className="w-full rounded-lg px-4 py-2.5 text-sm border outline-none appearance-none transition-colors"
                style={{
                  background: 'var(--bg-secondary)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-primary)',
                }}
              >
                {REMOTE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={back}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ color: 'var(--text-secondary)' }}
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={next}
                  className="text-xs font-medium underline transition-opacity hover:opacity-70"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Skip
                </button>
                <button
                  onClick={handleSavePreferences}
                  disabled={prefsSaving}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all"
                  style={{
                    background: 'var(--accent)',
                    color: '#fff',
                    opacity: prefsSaving ? 0.6 : 1,
                  }}
                >
                  {prefsSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowRight className="w-4 h-4" />
                  )}
                  Save & Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 5 - Done */}
        {step === 4 && (
          <div className="text-center space-y-6">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
              style={{ background: 'var(--success)' }}
            >
              <Check className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                You're all set!
              </h1>
              <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                Scout is ready to help you find your next role. Head to the dashboard to start exploring jobs.
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.setItem('scout_setup_dismissed', 'true')
                queryClient.invalidateQueries({ queryKey: ['setup-status'] })
                navigate('/dashboard')
              }}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium transition-all"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Go to Dashboard
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- Sub-components ---------- */

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </p>
      <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  )
}
