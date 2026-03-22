'use client'

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type Stage = 'idle' | 'analyzing' | 'translating' | 'evaluating' | 'testing' | 'done' | 'error'

type Analysis = {
  explanation: string
  complexity: string
  key_components: string[]
}

type Translation = {
  translated_code: string
  notes: string
}

type Evaluation = {
  faithfulness_score: number
  idiomaticity_score: number
  risk_level: string
  strengths: string[]
  issues: string[]
  reviewer_note: string
}

type TestResult = {
  test_code: string
  notes: string
}

type PipelineResult = {
  analysis: Analysis | null
  translation: Translation | null
  evaluation: Evaluation | null
  tests: TestResult | null
}

type ActiveTab = 'analysis' | 'translation' | 'evaluation' | 'tests'

// ── Sample Snippets ───────────────────────────────────────────────────────────

const SAMPLES: { label: string; language: string; code: string }[] = [
  {
    label: 'PB Event Handler',
    language: 'powerbuilder',
    code: `event clicked()
  int li_count
  string ls_name

  li_count = dw_employees.RowCount()
  if li_count = 0 then
    MessageBox("Warning", "No employees found")
    return
  end if

  ls_name = dw_employees.GetItemString(1, "emp_name")
  MessageBox("First Employee", ls_name)
end event`,
  },
  {
    label: 'PB DataWindow Query',
    language: 'powerbuilder',
    code: `function long f_get_salary(long al_emp_id) returns decimal
  decimal ldc_salary
  
  SELECT emp_salary
  INTO :ldc_salary
  FROM employees
  WHERE emp_id = :al_emp_id
  USING SQLCA;
  
  if SQLCA.SQLCode <> 0 then
    MessageBox("DB Error", SQLCA.SQLErrText)
    return -1
  end if
  
  return ldc_salary
end function`,
  },
  {
    label: 'PB Transaction',
    language: 'powerbuilder',
    code: `event ue_save()
  int li_rtn
  
  li_rtn = dw_orders.Update()
  
  if li_rtn = 1 then
    COMMIT USING SQLCA;
    MessageBox("Success", "Order saved successfully.")
  else
    ROLLBACK USING SQLCA;
    MessageBox("Error", "Save failed. Changes rolled back.")
  end if
end event`,
  },
]

// ── Pipeline Stage Config ─────────────────────────────────────────────────────

const STAGES: { key: Stage; label: string; icon: string }[] = [
  { key: 'analyzing', label: 'Analyzing', icon: '🔍' },
  { key: 'translating', label: 'Translating', icon: '⚙️' },
  { key: 'evaluating', label: 'Evaluating', icon: '🧪' },
  { key: 'testing', label: 'Testing', icon: '✅' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function riskColour(risk: string) {
  if (risk === 'Low') return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30'
  if (risk === 'High') return 'text-rose-400 bg-rose-400/10 border-rose-400/30'
  return 'text-amber-400 bg-amber-400/10 border-amber-400/30'
}

function complexityColour(c: string) {
  if (c === 'low') return 'text-emerald-400'
  if (c === 'high') return 'text-rose-400'
  return 'text-amber-400'
}

function scoreColour(score: number) {
  if (score >= 80) return 'bg-emerald-500'
  if (score >= 60) return 'bg-amber-500'
  return 'bg-rose-500'
}

async function copyToClipboard(text: string, setCopied: (v: boolean) => void) {
  try {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  } catch {
    /* ignore */
  }
}

function generateMarkdownReport(
  originalCode: string,
  result: PipelineResult,
  sourceLanguage: string,
): string {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const { analysis, translation, evaluation, tests } = result

  return `# P2C Migration Report
Generated: ${now}  
Source language: ${sourceLanguage}

## Original Code

\`\`\`${sourceLanguage}
${originalCode}
\`\`\`

## Analysis

**Complexity:** ${analysis?.complexity ?? 'N/A'}

${analysis?.explanation ?? ''}

**Key Components:**
${(analysis?.key_components ?? []).map((c) => `- ${c}`).join('\n')}

## Translated C# Code

\`\`\`csharp
${translation?.translated_code ?? ''}
\`\`\`

### Translation Notes

${translation?.notes ?? ''}

## Quality Evaluation

| Metric | Score |
|---|---|
| Faithfulness | ${evaluation?.faithfulness_score ?? 'N/A'}/100 |
| Idiomaticity | ${evaluation?.idiomaticity_score ?? 'N/A'}/100 |
| Risk Level | ${evaluation?.risk_level ?? 'N/A'} |

**Strengths:**
${(evaluation?.strengths ?? []).map((s) => `- ${s}`).join('\n')}

**Issues:**
${(evaluation?.issues ?? []).map((i) => `- ${i}`).join('\n')}

**Reviewer Note:**
${evaluation?.reviewer_note ?? ''}

## Generated Tests

\`\`\`csharp
${tests?.test_code ?? ''}
\`\`\`

### Test Coverage Notes

${tests?.notes ?? ''}
`
}

// ── Sub-Components ────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => copyToClipboard(text, setCopied)}
      className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-primary"
    >
      {copied ? '✓ Copied' : '⎘ Copy'}
    </button>
  )
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{score}/100</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`score-bar-fill h-full rounded-full ${scoreColour(score)}`}
          style={{ '--target-width': `${score}%` } as React.CSSProperties}
        />
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
  disabled,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  disabled: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition
        disabled:pointer-events-none disabled:opacity-40
        ${active
          ? 'bg-primary/10 text-primary border border-primary/30'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary border border-transparent'
        }
      `}
    >
      {children}
    </button>
  )
}

function CodeBlock({ code, language = '' }: { code: string; language?: string }) {
  return (
    <div className="relative rounded-xl border border-border bg-[oklch(0.07_0.01_240)] overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-xs text-muted-foreground font-mono">{language || 'code'}</span>
        <CopyButton text={code} />
      </div>
      <pre className="code-editor overflow-x-auto p-4 text-sm text-emerald-300 leading-relaxed">
        {code}
      </pre>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [legacyCode, setLegacyCode] = useState(SAMPLES[0].code)
  const [sourceLanguage, setSourceLanguage] = useState(SAMPLES[0].language)
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<PipelineResult>({
    analysis: null,
    translation: null,
    evaluation: null,
    tests: null,
  })
  const [activeTab, setActiveTab] = useState<ActiveTab>('analysis')
  const eventSourceRef = useRef<EventSource | null>(null)

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => eventSourceRef.current?.close()
  }, [])

  const handleSampleSelect = useCallback((idx: number) => {
    setLegacyCode(SAMPLES[idx].code)
    setSourceLanguage(SAMPLES[idx].language)
  }, [])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!legacyCode.trim()) return

    // Reset state
    setError('')
    setStage('analyzing')
    setResult({ analysis: null, translation: null, evaluation: null, tests: null })
    eventSourceRef.current?.close()

    try {
      // Use the non-streaming endpoint as fetch (SSE POST isn't broadly supported via EventSource)
      const res = await fetch(`${apiBase}/modernize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: legacyCode, source_language: sourceLanguage }),
      })

      if (!res.ok) {
        const msg = await res.text()
        throw new Error(msg || `Server error ${res.status}`)
      }

      // Stream the JSON response body progressively to animate stages
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let body = ''

      if (reader) {
        // Animate through stages while waiting
        const stageTimers = [
          setTimeout(() => setStage('translating'), 1200),
          setTimeout(() => setStage('evaluating'), 2400),
          setTimeout(() => setStage('testing'), 3600),
        ]

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          body += decoder.decode(value, { stream: true })
        }

        stageTimers.forEach(clearTimeout)
      } else {
        body = await res.text()
      }

      const json = JSON.parse(body)

      setResult({
        analysis: {
          explanation: json.analysis,
          complexity: json.complexity,
          key_components: json.key_components ?? [],
        },
        translation: {
          translated_code: json.translated_code,
          notes: json.translation_notes,
        },
        evaluation: json.evaluation,
        tests: {
          test_code: json.test_cases,
          notes: json.test_notes,
        },
      })

      setStage('done')
      setActiveTab('analysis')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStage('error')
    }
  }

  function handleDownloadReport() {
    if (!result.analysis) return
    const md = generateMarkdownReport(legacyCode, result, sourceLanguage)
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `p2c-migration-report-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const isRunning = stage !== 'idle' && stage !== 'done' && stage !== 'error'
  const hasResult = stage === 'done' && result.analysis !== null

  const activeStageIdx = STAGES.findIndex((s) => s.key === stage)

  return (
    <main className="min-h-screen px-4 py-8 md:px-8 lg:px-12">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">

        {/* ── Header ── */}
        <header className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
              v2.0
            </span>
            <span className="text-xs text-muted-foreground uppercase tracking-widest">
              AI Migration Pipeline
            </span>
          </div>
          <h1 className="shimmer-text text-4xl font-bold tracking-tight md:text-5xl">
            P2C Modernizer
          </h1>
          <p className="max-w-2xl text-base text-muted-foreground">
            Analyze → Translate → Evaluate → Test. A self-evaluating AI pipeline that turns
            legacy PowerBuilder, COBOL &amp; VB6 into production-grade C# .NET 8.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {['GPT-4o', 'FastAPI', 'Next.js 15', 'LLM-as-Judge', 'SSE Streaming'].map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border bg-secondary px-3 py-0.5 text-xs text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">

          {/* ── Left: Editor + Submit ── */}
          <div className="flex flex-col gap-4">

            {/* Sample selector */}
            <div className="flex flex-wrap gap-2">
              <span className="self-center text-xs text-muted-foreground">Try a sample:</span>
              {SAMPLES.map((s, i) => (
                <button
                  key={s.label}
                  onClick={() => handleSampleSelect(i)}
                  disabled={isRunning}
                  className={`
                    rounded-lg border px-3 py-1.5 text-xs font-medium transition
                    disabled:pointer-events-none disabled:opacity-40
                    ${legacyCode === s.code
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-border/80 hover:text-foreground'
                    }
                  `}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Code editor */}
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="relative overflow-hidden rounded-xl border border-border bg-[oklch(0.07_0.01_240)] transition focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
                <div className="flex items-center gap-2 border-b border-border bg-secondary/40 px-4 py-2">
                  <div className="flex gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-rose-500/70" />
                    <span className="h-3 w-3 rounded-full bg-amber-500/70" />
                    <span className="h-3 w-3 rounded-full bg-emerald-500/70" />
                  </div>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {sourceLanguage}.pb
                  </span>
                </div>
                <textarea
                  id="legacy-code-input"
                  value={legacyCode}
                  onChange={(e) => setLegacyCode(e.target.value)}
                  rows={18}
                  disabled={isRunning}
                  className="code-editor w-full bg-transparent p-5 text-emerald-200 outline-none disabled:opacity-60"
                  placeholder="Paste your legacy PowerBuilder, COBOL, or VB6 code here…"
                  spellCheck={false}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">Source:</label>
                  <select
                    value={sourceLanguage}
                    onChange={(e) => setSourceLanguage(e.target.value)}
                    disabled={isRunning}
                    className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary/50"
                  >
                    <option value="powerbuilder">PowerBuilder</option>
                    <option value="cobol">COBOL</option>
                    <option value="vb6">VB6</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={isRunning || !legacyCode.trim()}
                  id="run-pipeline-btn"
                  className="
                    inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold
                    text-primary-foreground transition hover:opacity-90
                    disabled:cursor-not-allowed disabled:opacity-50
                  "
                >
                  {isRunning
                    ? <><span className="animate-spin">⟳</span> Running…</>
                    : <><span>▶</span> Run Pipeline</>
                  }
                </button>

                {hasResult && (
                  <button
                    type="button"
                    onClick={handleDownloadReport}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                  >
                    ↓ Download Report
                  </button>
                )}
              </div>
            </form>

            {error && (
              <div className="animate-slide-up rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                <span className="font-semibold">Error: </span>{error}
              </div>
            )}
          </div>

          {/* ── Right: Pipeline Status + Evaluation Card ── */}
          <div className="flex flex-col gap-4">

            {/* Pipeline progress */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Pipeline
              </h2>
              <div className="space-y-3">
                {STAGES.map((s, i) => {
                  const isActive = s.key === stage
                  const isDone = hasResult || activeStageIdx > i
                  return (
                    <div key={s.key} className="flex items-center gap-3">
                      <span
                        className={`
                          flex h-8 w-8 items-center justify-center rounded-lg border text-sm transition
                          ${isDone ? 'border-primary/40 bg-primary/10 text-primary'
                            : isActive ? 'border-primary/60 bg-primary/20 text-primary animate-pulse'
                            : 'border-border bg-secondary text-muted-foreground'
                          }
                        `}
                      >
                        {isDone ? '✓' : s.icon}
                      </span>
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${isActive ? 'text-primary' : isDone ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {s.label}
                        </p>
                      </div>
                      {isActive && (
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Evaluation card */}
            {result.evaluation && (
              <div className="animate-slide-up rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Quality Score
                  </h2>
                  <span
                    className={`rounded-full border px-3 py-0.5 text-xs font-semibold ${riskColour(result.evaluation.risk_level)}`}
                  >
                    {result.evaluation.risk_level} Risk
                  </span>
                </div>
                <ScoreBar label="Faithfulness" score={result.evaluation.faithfulness_score} />
                <ScoreBar label="Idiomaticity" score={result.evaluation.idiomaticity_score} />

                {result.evaluation.strengths.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-emerald-400 mb-1">✓ Strengths</p>
                    <ul className="space-y-1">
                      {result.evaluation.strengths.slice(0, 3).map((s, i) => (
                        <li key={i} className="text-xs text-muted-foreground">• {s}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.evaluation.issues.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-rose-400 mb-1">⚠ Issues</p>
                    <ul className="space-y-1">
                      {result.evaluation.issues.slice(0, 3).map((s, i) => (
                        <li key={i} className="text-xs text-muted-foreground">• {s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Results Tabs ── */}
        {hasResult && (
          <section className="animate-slide-up space-y-4">
            <div className="flex flex-wrap gap-2 border-b border-border pb-3">
              {(
                [
                  { key: 'analysis', label: '🔍 Analysis' },
                  { key: 'translation', label: '⚙️ C# Translation' },
                  { key: 'evaluation', label: '🧪 Evaluation' },
                  { key: 'tests', label: '✅ Test Cases' },
                ] as { key: ActiveTab; label: string }[]
              ).map((tab) => (
                <TabButton
                  key={tab.key}
                  active={activeTab === tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  disabled={false}
                >
                  {tab.label}
                </TabButton>
              ))}
            </div>

            {activeTab === 'analysis' && result.analysis && (
              <div className="animate-slide-up space-y-4">
                <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Complexity</span>
                    <span className={`text-sm font-semibold capitalize ${complexityColour(result.analysis.complexity)}`}>
                      {result.analysis.complexity}
                    </span>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">{result.analysis.explanation}</p>
                  {result.analysis.key_components.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Key Components</p>
                      <div className="flex flex-wrap gap-2">
                        {result.analysis.key_components.map((c, i) => (
                          <span key={i} className="rounded-md border border-border bg-secondary px-2.5 py-1 text-xs text-foreground">
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'translation' && result.translation && (
              <div className="animate-slide-up space-y-4">
                <CodeBlock code={result.translation.translated_code} language="csharp" />
                {result.translation.notes && (
                  <div className="rounded-xl border border-border bg-card p-5">
                    <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Translation Notes</p>
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{result.translation.notes}</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'evaluation' && result.evaluation && (
              <div className="animate-slide-up space-y-4">
                <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <ScoreBar label="Faithfulness Score" score={result.evaluation.faithfulness_score} />
                    <ScoreBar label="Idiomaticity Score" score={result.evaluation.idiomaticity_score} />
                  </div>
                  <div className="pt-2">
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${riskColour(result.evaluation.risk_level)}`}>
                      {result.evaluation.risk_level} Risk
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Reviewer Note</p>
                    <p className="text-sm text-foreground leading-relaxed">{result.evaluation.reviewer_note}</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {result.evaluation.strengths.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-emerald-400 mb-2">✓ Strengths</p>
                        <ul className="space-y-1.5">
                          {result.evaluation.strengths.map((s, i) => (
                            <li key={i} className="text-sm text-muted-foreground">• {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {result.evaluation.issues.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-rose-400 mb-2">⚠ Issues</p>
                        <ul className="space-y-1.5">
                          {result.evaluation.issues.map((s, i) => (
                            <li key={i} className="text-sm text-muted-foreground">• {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'tests' && result.tests && (
              <div className="animate-slide-up space-y-4">
                <CodeBlock code={result.tests.test_code} language="csharp — xUnit tests" />
                {result.tests.notes && (
                  <div className="rounded-xl border border-border bg-card p-5">
                    <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Coverage Notes</p>
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{result.tests.notes}</p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
