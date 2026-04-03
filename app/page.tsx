'use client'

import { FormEvent, useCallback, useState } from 'react'

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

const SAMPLES: { label: string; language: string; code: string }[] = [
  {
    label: 'PB event handler',
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
    label: 'PB query function',
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
    label: 'PB save',
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

const STAGES: { key: Stage; label: string }[] = [
  { key: 'analyzing', label: 'Understand' },
  { key: 'translating', label: 'Translate' },
  { key: 'evaluating', label: 'Review' },
  { key: 'testing', label: 'Tests' },
]

function modernizeUrl(): string {
  const direct = process.env.NEXT_PUBLIC_API_BASE_URL?.trim()
  if (direct) return `${direct.replace(/\/$/, '')}/modernize`
  return '/api/modernize'
}

async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const j = JSON.parse(text) as { detail?: unknown }
    if (typeof j.detail === 'string') return j.detail
    if (Array.isArray(j.detail)) {
      return j.detail
        .map((item: unknown) => {
          if (item && typeof item === 'object' && 'msg' in item) {
            return String((item as { msg?: string }).msg ?? item)
          }
          return String(item)
        })
        .join(' ')
    }
  } catch {
    /* use raw text */
  }
  return text.trim() || `Something went wrong (${res.status})`
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, Math.round(n)))
}

function normalizeEvaluation(raw: unknown): Evaluation | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  return {
    faithfulness_score: clampScore(Number(e.faithfulness_score)),
    idiomaticity_score: clampScore(Number(e.idiomaticity_score)),
    risk_level: typeof e.risk_level === 'string' ? e.risk_level : 'Medium',
    strengths: Array.isArray(e.strengths)
      ? e.strengths.filter((x): x is string => typeof x === 'string')
      : [],
    issues: Array.isArray(e.issues) ? e.issues.filter((x): x is string => typeof x === 'string') : [],
    reviewer_note: typeof e.reviewer_note === 'string' ? e.reviewer_note : '',
  }
}

function riskClass(risk: string) {
  const r = risk.toLowerCase()
  if (r === 'low') return 'border-emerald-600/25 bg-emerald-50 text-emerald-900'
  if (r === 'high') return 'border-rose-600/25 bg-rose-50 text-rose-900'
  return 'border-amber-600/25 bg-amber-50 text-amber-900'
}

function complexityClass(c: string) {
  const x = c.toLowerCase()
  if (x === 'low') return 'text-emerald-700'
  if (x === 'high') return 'text-rose-700'
  return 'text-amber-800'
}

function scoreBarClass(score: number) {
  if (score >= 80) return 'bg-emerald-600'
  if (score >= 60) return 'bg-amber-600'
  return 'bg-rose-600'
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

  return `# P2C migration notes
Generated: ${now}
Source: ${sourceLanguage}

## Original

\`\`\`${sourceLanguage}
${originalCode}
\`\`\`

## Analysis

Complexity: ${analysis?.complexity ?? '—'}

${analysis?.explanation ?? ''}

**Parts worth noting:**  
${(analysis?.key_components ?? []).map((c) => `- ${c}`).join('\n')}

## C#

\`\`\`csharp
${translation?.translated_code ?? ''}
\`\`\`

### Notes

${translation?.notes ?? ''}

## Quality

| | |
|---|---|
| Faithfulness | ${evaluation?.faithfulness_score ?? '—'}/100 |
| Idiomaticity | ${evaluation?.idiomaticity_score ?? '—'}/100 |
| Risk | ${evaluation?.risk_level ?? '—'} |

**Strengths:**  
${(evaluation?.strengths ?? []).map((s) => `- ${s}`).join('\n')}

**Watch out:**  
${(evaluation?.issues ?? []).map((i) => `- ${i}`).join('\n')}

**Summary:** ${evaluation?.reviewer_note ?? ''}

## Tests

\`\`\`csharp
${tests?.test_code ?? ''}
\`\`\`

${tests?.notes ?? ''}
`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => copyToClipboard(text, setCopied)}
      className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition hover:border-foreground/20 hover:text-foreground"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums font-medium text-foreground">{score}/100</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`score-bar-fill h-full rounded-full ${scoreBarClass(score)}`}
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
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`
        whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition
        disabled:pointer-events-none disabled:opacity-40
        ${
          active
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }
      `}
    >
      {children}
    </button>
  )
}

function CodeBlock({ code, language = '' }: { code: string; language?: string }) {
  return (
    <div className="code-surface overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-xs text-muted-foreground">{language || 'code'}</span>
        <CopyButton text={code} />
      </div>
      <pre className="code-editor overflow-x-auto p-4 text-[13px] leading-relaxed">{code}</pre>
    </div>
  )
}

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

  const handleSampleSelect = useCallback((idx: number) => {
    setLegacyCode(SAMPLES[idx].code)
    setSourceLanguage(SAMPLES[idx].language)
  }, [])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!legacyCode.trim()) return

    setError('')
    setStage('analyzing')
    setResult({ analysis: null, translation: null, evaluation: null, tests: null })

    try {
      const res = await fetch(modernizeUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: legacyCode, source_language: sourceLanguage }),
      })

      if (!res.ok) {
        throw new Error(await readErrorMessage(res))
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let body = ''

      if (reader) {
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

      let json: Record<string, unknown>
      try {
        json = JSON.parse(body) as Record<string, unknown>
      } catch {
        throw new Error('The server returned something that is not valid JSON.')
      }

      const evaluation = normalizeEvaluation(json.evaluation)
      if (!evaluation) {
        throw new Error('The response did not include a usable evaluation block.')
      }

      const keyComponents = json.key_components
      setResult({
        analysis: {
          explanation: typeof json.analysis === 'string' ? json.analysis : '',
          complexity: typeof json.complexity === 'string' ? json.complexity : 'unknown',
          key_components: Array.isArray(keyComponents)
            ? keyComponents.filter((x): x is string => typeof x === 'string')
            : [],
        },
        translation: {
          translated_code: typeof json.translated_code === 'string' ? json.translated_code : '',
          notes: typeof json.translation_notes === 'string' ? json.translation_notes : '',
        },
        evaluation,
        tests: {
          test_code: typeof json.test_cases === 'string' ? json.test_cases : '',
          notes: typeof json.test_notes === 'string' ? json.test_notes : '',
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
    a.download = `p2c-notes-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const isRunning = stage !== 'idle' && stage !== 'done' && stage !== 'error'
  const hasResult = stage === 'done' && result.analysis !== null
  const activeStageIdx = STAGES.findIndex((s) => s.key === stage)

  return (
    <main className="min-h-screen px-4 py-10 md:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-10">
        <header className="animate-fade-in space-y-3">
          <p className="text-sm text-muted-foreground">Legacy code → C# (.NET 8)</p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">P2C</h1>
          <p className="max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Paste what you have. You get a short read on what it does, C# that matches the intent, a
            blunt quality pass, and starter tests. Nothing fancy — just enough to move forward.
          </p>
        </header>

        <div className="flex flex-col gap-8">
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Examples</p>
            <div className="flex flex-wrap gap-2">
              {SAMPLES.map((s, i) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => handleSampleSelect(i)}
                  disabled={isRunning}
                  className={`
                    rounded-md border px-3 py-1.5 text-sm transition
                    disabled:pointer-events-none disabled:opacity-40
                    ${
                      legacyCode === s.code
                        ? 'border-foreground/30 bg-muted text-foreground'
                        : 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground'
                    }
                  `}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label htmlFor="legacy-code-input" className="text-sm font-medium text-foreground">
              Your code
            </label>
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              <div className="border-b border-border px-3 py-2">
                <span className="font-mono text-xs text-muted-foreground">{sourceLanguage}</span>
              </div>
              <textarea
                id="legacy-code-input"
                value={legacyCode}
                onChange={(e) => setLegacyCode(e.target.value)}
                rows={16}
                disabled={isRunning}
                className="code-editor code-surface w-full border-0 p-4 outline-none ring-0 disabled:opacity-60"
                placeholder="Paste legacy code here."
                spellCheck={false}
              />
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Language</span>
                <select
                  value={sourceLanguage}
                  onChange={(e) => setSourceLanguage(e.target.value)}
                  disabled={isRunning}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
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
                className="rounded-md bg-foreground px-5 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRunning ? 'Working…' : 'Run'}
              </button>

              {hasResult && (
                <button
                  type="button"
                  onClick={handleDownloadReport}
                  className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition hover:border-foreground/25 hover:text-foreground"
                >
                  Download notes
                </button>
              )}
            </div>
          </form>

          {error && (
            <div
              role="alert"
              className="animate-fade-in rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-[1fr_minmax(200px,240px)]">
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Progress
              </p>
              <ul className="space-y-3">
                {STAGES.map((s, i) => {
                  const isActive = s.key === stage
                  const isDone = hasResult || activeStageIdx > i
                  return (
                    <li key={s.key} className="flex items-center gap-3">
                      <span
                        className={`
                          flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium
                          ${
                            isDone
                              ? 'border-foreground/20 bg-muted text-foreground'
                              : isActive
                                ? 'border-foreground/40 bg-background text-foreground'
                                : 'border-border text-muted-foreground'
                          }
                        `}
                      >
                        {isDone ? '✓' : i + 1}
                      </span>
                      <span
                        className={`text-sm ${isActive ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
                      >
                        {s.label}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>

            {result.evaluation && (
              <div className="animate-fade-in rounded-lg border border-border bg-card p-4 shadow-sm">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Quick read
                  </p>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${riskClass(result.evaluation.risk_level)}`}
                  >
                    {result.evaluation.risk_level} risk
                  </span>
                </div>
                <ScoreBar label="Faithfulness" score={result.evaluation.faithfulness_score} />
                <div className="h-3" />
                <ScoreBar label="Idiomaticity" score={result.evaluation.idiomaticity_score} />
              </div>
            )}
          </div>
        </div>

        {hasResult && (
          <section className="animate-fade-in space-y-4">
            <div className="flex flex-wrap gap-1 border-b border-border pb-2">
              {(
                [
                  { key: 'analysis' as const, label: 'Analysis' },
                  { key: 'translation' as const, label: 'C#' },
                  { key: 'evaluation' as const, label: 'Review' },
                  { key: 'tests' as const, label: 'Tests' },
                ] as const
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
              <div className="animate-fade-in space-y-4">
                <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
                  <div className="mb-2 flex flex-wrap items-baseline gap-2">
                    <span className="text-xs text-muted-foreground">Complexity</span>
                    <span className={`text-sm font-medium capitalize ${complexityClass(result.analysis.complexity)}`}>
                      {result.analysis.complexity}
                    </span>
                  </div>
                  <p className="text-[15px] leading-relaxed text-foreground">{result.analysis.explanation}</p>
                  {result.analysis.key_components.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-2 text-xs text-muted-foreground">In the mix</p>
                      <div className="flex flex-wrap gap-2">
                        {result.analysis.key_components.map((c, i) => (
                          <span
                            key={i}
                            className="rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-foreground"
                          >
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
              <div className="animate-fade-in space-y-4">
                <CodeBlock code={result.translation.translated_code} language="csharp" />
                {result.translation.notes ? (
                  <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
                    <p className="mb-2 text-xs text-muted-foreground">Notes</p>
                    <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
                      {result.translation.notes}
                    </p>
                  </div>
                ) : null}
              </div>
            )}

            {activeTab === 'evaluation' && result.evaluation && (
              <div className="animate-fade-in space-y-4">
                <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
                  <div className="mb-4 grid gap-4 sm:grid-cols-2">
                    <ScoreBar label="Faithfulness" score={result.evaluation.faithfulness_score} />
                    <ScoreBar label="Idiomaticity" score={result.evaluation.idiomaticity_score} />
                  </div>
                  <span
                    className={`inline-block rounded-full border px-2 py-1 text-xs font-medium ${riskClass(result.evaluation.risk_level)}`}
                  >
                    {result.evaluation.risk_level} risk
                  </span>
                  <div className="mt-4">
                    <p className="mb-2 text-xs text-muted-foreground">Summary</p>
                    <p className="text-[15px] leading-relaxed text-foreground">{result.evaluation.reviewer_note}</p>
                  </div>
                  <div className="mt-6 grid gap-6 sm:grid-cols-2">
                    {result.evaluation.strengths.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs font-medium text-emerald-800">What worked</p>
                        <ul className="space-y-1.5">
                          {result.evaluation.strengths.map((s, i) => (
                            <li key={i} className="text-sm text-muted-foreground">
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {result.evaluation.issues.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs font-medium text-rose-800">Worth fixing</p>
                        <ul className="space-y-1.5">
                          {result.evaluation.issues.map((s, i) => (
                            <li key={i} className="text-sm text-muted-foreground">
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'tests' && result.tests && (
              <div className="animate-fade-in space-y-4">
                <CodeBlock code={result.tests.test_code} language="xUnit" />
                {result.tests.notes ? (
                  <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
                    <p className="mb-2 text-xs text-muted-foreground">Coverage notes</p>
                    <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
                      {result.tests.notes}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
