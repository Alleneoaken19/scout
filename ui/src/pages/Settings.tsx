import { useState, useEffect, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Key, Check, Loader2, AlertCircle, ShieldCheck } from 'lucide-react'
import { fetchSettings, saveSettings, validateApiKey } from '../api'

interface SettingsData {
  ai_provider: string
  ai_api_key: string
  ai_model: string
  has_ai_key: boolean
  anthropic_api_key: string
  anthropic_model: string
  has_anthropic_key: boolean
  notion_token: string
  notion_db_id: string
  has_notion_token: boolean
}

const PROVIDER_OPTIONS = [
  { value: 'gemini', label: 'Google Gemini (free)' },
  { value: 'ollama', label: 'Ollama (free, local)' },
  { value: 'anthropic', label: 'Anthropic Claude (paid)' },
]

const MODEL_OPTIONS: Record<string, { value: string; label: string }[]> = {
  anthropic: [
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast, cheap)' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (best)' },
  ],
  gemini: [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (fast, free)' },
    { value: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash (preview)' },
  ],
  ollama: [
    { value: 'llama3.2', label: 'Llama 3.2 (default)' },
    { value: 'mistral', label: 'Mistral' },
    { value: 'gemma2', label: 'Gemma 2' },
    { value: 'qwen2.5', label: 'Qwen 2.5' },
  ],
}

export default function Settings() {
  const queryClient = useQueryClient()
  const [toast, setToast] = useState<string | null>(null)

  // Form state
  const [aiProvider, setAiProvider] = useState('gemini')
  const [aiKey, setAiKey] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [notionToken, setNotionToken] = useState('')
  const [notionDbId, setNotionDbId] = useState('')

  const [keyTouched, setKeyTouched] = useState(false)
  const [notionTokenTouched, setNotionTokenTouched] = useState(false)

  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string } | null>(null)

  const { data, isLoading } = useQuery<SettingsData>({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  })

  useEffect(() => {
    if (data) {
      setAiProvider(data.ai_provider || 'gemini')
      setAiModel(data.ai_model || '')
      setNotionDbId(data.notion_db_id || '')
      setAiKey('')
      setNotionToken('')
      setKeyTouched(false)
      setNotionTokenTouched(false)
      setValidationResult(null)
    }
  }, [data])

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, string>) => saveSettings(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setToast('Settings saved successfully')
    },
    onError: (err: Error) => {
      setToast(`Failed to save: ${err.message}`)
    },
  })

  const handleValidateKey = async () => {
    setValidating(true)
    setValidationResult(null)
    try {
      const result = await validateApiKey(aiKey.trim() || '', aiProvider)
      setValidationResult(result)
    } catch (err: any) {
      setValidationResult({ valid: false, error: err.message || 'Validation request failed' })
    } finally {
      setValidating(false)
    }
  }

  const handleSave = () => {
    const payload: Record<string, string> = {
      ai_provider: aiProvider,
      ai_model: aiModel,
      notion_db_id: notionDbId,
    }
    if (keyTouched && aiKey.trim()) {
      payload.ai_api_key = aiKey.trim()
      // Also set legacy field for backward compat
      if (aiProvider === 'anthropic') {
        payload.anthropic_api_key = aiKey.trim()
        payload.anthropic_model = aiModel
      }
    }
    if (notionTokenTouched && notionToken.trim()) {
      payload.notion_token = notionToken.trim()
    }
    saveMutation.mutate(payload)
  }

  const needsKey = aiProvider !== 'ollama'
  const providerModels = MODEL_OPTIONS[aiProvider] || []

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Settings</h1>
        <div className="animate-pulse space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl" style={{ background: 'var(--bg-card)' }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {toast && (
        <div
          className="fixed top-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium shadow-lg transition-all"
          style={{
            background: toast.includes('Failed') ? 'var(--danger)' : 'var(--success)',
            color: '#fff',
          }}
        >
          {toast.includes('Failed') ? <AlertCircle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Settings</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            AI provider and integration configuration
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all"
          style={{ background: 'var(--accent)', color: '#fff', opacity: saveMutation.isPending ? 0.7 : 1 }}
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
          {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="space-y-5">
        <SectionHeading title="AI Provider" />

        {/* Provider selector */}
        <FormCard title="Provider" description="Choose which AI service to use for scoring and resume tailoring">
          <select
            value={aiProvider}
            onChange={(e) => {
              setAiProvider(e.target.value)
              setAiModel(MODEL_OPTIONS[e.target.value]?.[0]?.value || '')
              setValidationResult(null)
            }}
            className="w-full rounded-lg px-4 py-2.5 text-sm border outline-none appearance-none transition-colors"
            style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            {PROVIDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </FormCard>

        {/* API Key — only for providers that need it */}
        {needsKey && (
          <FormCard
            title="API Key"
            description={
              aiProvider === 'gemini'
                ? 'Free API key from aistudio.google.com/app/apikey'
                : 'API key from console.anthropic.com/settings/keys (~$5/month)'
            }
          >
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <input
                  type="password"
                  value={aiKey}
                  onChange={(e) => {
                    setAiKey(e.target.value)
                    setKeyTouched(true)
                    setValidationResult(null)
                  }}
                  placeholder={data?.has_ai_key ? `Key set (${data.ai_api_key})` : 'Paste your API key...'}
                  className="w-full rounded-lg px-4 py-2.5 text-sm border outline-none transition-colors"
                  style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
              <button
                onClick={handleValidateKey}
                disabled={validating || (!aiKey.trim() && !data?.has_ai_key)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap"
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  opacity: validating ? 0.6 : 1,
                }}
              >
                {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                Validate
              </button>
            </div>
            {validationResult && (
              <div
                className="flex items-center gap-2 mt-2 text-sm font-medium"
                style={{ color: validationResult.valid ? 'var(--success)' : 'var(--danger)' }}
              >
                {validationResult.valid ? (
                  <><Check className="w-4 h-4" /> API key is valid</>
                ) : (
                  <><AlertCircle className="w-4 h-4" /> {validationResult.error || 'Invalid API key'}</>
                )}
              </div>
            )}
          </FormCard>
        )}

        {/* Ollama info */}
        {aiProvider === 'ollama' && (
          <FormCard title="Ollama Status" description="Ollama runs locally on your machine — no API key needed">
            <button
              onClick={handleValidateKey}
              disabled={validating}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            >
              {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Check Connection
            </button>
            {validationResult && (
              <div
                className="flex items-center gap-2 mt-2 text-sm font-medium"
                style={{ color: validationResult.valid ? 'var(--success)' : 'var(--danger)' }}
              >
                {validationResult.valid ? (
                  <><Check className="w-4 h-4" /> Ollama is running</>
                ) : (
                  <><AlertCircle className="w-4 h-4" /> {validationResult.error}</>
                )}
              </div>
            )}
          </FormCard>
        )}

        {/* Model selector */}
        <FormCard title="Model" description="Choose which model to use">
          <select
            value={aiModel}
            onChange={(e) => setAiModel(e.target.value)}
            className="w-full rounded-lg px-4 py-2.5 text-sm border outline-none appearance-none transition-colors"
            style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            {providerModels.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </FormCard>

        <SectionHeading title="Integrations (Optional)" />

        <FormCard title="Notion Token" description="Optional. Connect Notion to sync your job tracking board.">
          <input
            type="password"
            value={notionToken}
            onChange={(e) => { setNotionToken(e.target.value); setNotionTokenTouched(true) }}
            placeholder={data?.has_notion_token ? `Token set (${data.notion_token})` : 'ntn_...'}
            className="w-full rounded-lg px-4 py-2.5 text-sm border outline-none transition-colors"
            style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          />
        </FormCard>

        <FormCard title="Notion Database ID" description="Optional. The ID of the Notion database to sync jobs into.">
          <input
            type="text"
            value={notionDbId}
            onChange={(e) => setNotionDbId(e.target.value)}
            placeholder="e.g. 8a2b3c4d5e6f..."
            className="w-full rounded-lg px-4 py-2.5 text-sm border outline-none transition-colors"
            style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          />
        </FormCard>
      </div>

      <div className="flex justify-end pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all"
          style={{ background: 'var(--accent)', color: '#fff', opacity: saveMutation.isPending ? 0.7 : 1 }}
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

function SectionHeading({ title }: { title: string }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wider pt-2" style={{ color: 'var(--text-secondary)' }}>
      {title}
    </h2>
  )
}

function FormCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{title}</label>
      {description && <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>{description}</p>}
      {children}
    </div>
  )
}
