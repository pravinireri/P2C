'use client'

import { FormEvent, useCallback, useRef, useState } from 'react'
import * as Diff from 'diff'

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

type ActiveTab = 'analysis' | 'translation' | 'diff' | 'evaluation' | 'tests'

type BatchQueueItem = { filename: string; code: string }

type BatchRow = {
  id: string
  filename: string
  stage: Stage
  progressPercent: number
  error?: string
  result: PipelineResult | null
  originalCode: string
}

const SAMPLES: { label: string; language: string; code: string }[] = [
  {
    label: 'PB click handler',
    language: 'powerbuilder',
    code: `// PB event handler - dw_employees clicked!
long ll_row
string ls_name

ll_row = dw_employees.GetRow()
if ll_row <= 0 then
    MessageBox("Warning", "No row is currently selected.")
    return
end if

ls_name = dw_employees.GetItemString(ll_row, "emp_name")
if IsNull(ls_name) or Len(ls_name) = 0 then
    MessageBox("Error", "Employee name is empty or null.")
else
    MessageBox("Employee Selected", ls_name)
end if`,
  },
  {
    label: 'PB query function',
    language: 'powerbuilder',
    code: `function long f_get_salary (long al_emp_id) returns decimal
  decimal ldc_salary

  SELECT emp_salary
    INTO :ldc_salary
    FROM employees
   WHERE emp_id = :al_emp_id
   USING SQLCA;

  CHOOSE CASE SQLCA.SQLCode
    CASE 0
      return ldc_salary
    CASE 100
      MessageBox("Not Found", "No salary record for employee " + String(al_emp_id) + ".")
      return -1
    CASE ELSE
      MessageBox("DB Error", SQLCA.SQLErrText)
      return -1
  END CHOOSE
end function`,
  },
  {
    label: 'PB save event',
    language: 'powerbuilder',
    code: `event ue_save()
  int li_rtn
  long ll_rows_modified

  if dw_orders.ModifiedCount() + dw_orders.DeletedCount() = 0 then
    MessageBox("Info", "No changes to save.")
    return
  end if

  li_rtn = dw_orders.Update()

  if li_rtn = 1 then
    COMMIT USING SQLCA;
    if SQLCA.SQLCode <> 0 then
      ROLLBACK USING SQLCA;
      MessageBox("Error", "Commit failed: " + SQLCA.SQLErrText)
    else
      MessageBox("Success", "Order saved successfully.")
    end if
  else
    ROLLBACK USING SQLCA;
    MessageBox("Error", "Save failed. Changes have been rolled back.")
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

function migrateBatchStartUrl(): string {
  const direct = process.env.NEXT_PUBLIC_API_BASE_URL?.trim()
  if (direct) return `${direct.replace(/\/$/, '')}/migrate-batch/start`
  return '/api/migrate-batch/start'
}

function batchStreamUrl(runId: string, fileIndex: number): string {
  const direct = process.env.NEXT_PUBLIC_API_BASE_URL?.trim()
  if (direct) return `${direct.replace(/\/$/, '')}/stream/${encodeURIComponent(runId)}/${fileIndex}`
  return `/api/stream/${encodeURIComponent(runId)}/${fileIndex}`
}

function stageToFallbackProgress(stage: Stage): number {
  switch (stage) {
    case 'analyzing':
      return 15
    case 'translating':
      return 40
    case 'evaluating':
      return 75
    case 'testing':
      return 90
    case 'done':
      return 100
    default:
      return 0
  }
}

function formatBatchRowStatus(row: BatchRow): string {
  if (row.stage === 'error') return `${row.filename}: —`
  if (row.stage === 'done') return `${row.filename}: 100% (Tests ✓)`
  const labelByStage: Partial<Record<Stage, string>> = {
    analyzing: 'Understand',
    translating: 'Translate',
    evaluating: 'Review',
    testing: 'Tests',
  }
  const label = labelByStage[row.stage] ?? row.stage
  return `${row.filename}: ${row.progressPercent}% (${label} ✓)`
}

async function readSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (eventName: string, data: unknown) => void,
): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      let eventName = ''
      const dataLines: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        }
      }
      const dataStr = dataLines.join('\n')
      if (!dataStr) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(dataStr)
      } catch {
        parsed = dataStr
      }
      onEvent(eventName || 'message', parsed)
    }
  }
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
  }
  return text.trim() || `Something went wrong (${res.status})`
}

function normalizeCode(raw: string): string {
  return raw
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\t/g, '    ')
    .trimEnd()
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

function parseModernizePayload(json: Record<string, unknown>): PipelineResult {
  const evaluation = normalizeEvaluation(json.evaluation)
  if (!evaluation) {
    throw new Error('The response did not include a usable evaluation block.')
  }
  const keyComponents = json.key_components
  return {
    analysis: {
      explanation: typeof json.analysis === 'string' ? json.analysis : '',
      complexity: typeof json.complexity === 'string' ? json.complexity : 'unknown',
      key_components: Array.isArray(keyComponents)
        ? keyComponents.filter((x): x is string => typeof x === 'string')
        : [],
    },
    translation: {
      translated_code: normalizeCode(typeof json.translated_code === 'string' ? json.translated_code : ''),
      notes: typeof json.translation_notes === 'string' ? json.translation_notes : '',
    },
    evaluation,
    tests: {
      test_code: normalizeCode(typeof json.test_cases === 'string' ? json.test_cases : ''),
      notes: typeof json.test_notes === 'string' ? json.test_notes : '',
    },
  }
}

function riskClass(risk: string) {
  const r = risk.toLowerCase()
  if (r === 'low') return 'border-foreground/20 bg-background text-foreground'
  if (r === 'high') return 'border-foreground bg-foreground text-background'
  return 'border-foreground/40 bg-muted text-foreground'
}

function progressIcon(stageKey: string, isDone: boolean, isActive: boolean): { icon: string; colorClass: string } {
  if (!isDone) {
    return {
      icon: isActive ? '...' : '',
      colorClass: isActive ? 'border-foreground bg-background text-foreground' : 'border-border text-muted-foreground',
    }
  }
  return { icon: 'Done', colorClass: 'border-foreground bg-foreground text-background' }
}

function scoreBarClass() {
  return 'bg-foreground'
}

async function copyToClipboard(text: string, setCopied: (v: boolean) => void) {
  try {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  } catch {
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

Complexity: ${analysis?.complexity ?? '--'}

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
| Faithfulness | ${evaluation?.faithfulness_score ?? '--'}/100 |
| Idiomaticity | ${evaluation?.idiomaticity_score ?? '--'}/100 |
| Risk | ${evaluation?.risk_level ?? '--'} |

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
      className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition hover:border-foreground hover:text-foreground"
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
          className={`score-bar-fill h-full rounded-full ${scoreBarClass()}`}
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
      <pre className="code-editor overflow-x-auto p-4 text-[13px] leading-relaxed" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{code}</pre>
    </div>
  )
}

function DiffView({ oldCode, newCode }: { oldCode: string; newCode: string }) {
  const diffResult = Diff.diffLines(oldCode, newCode)
  const rows: { left: { text: string; type: string }; right: { text: string; type: string } }[] = []

  let i = 0
  while (i < diffResult.length) {
    const part = diffResult[i]
    const nextPart = diffResult[i + 1]

    if (part.removed && nextPart?.added) {
      const leftLines = part.value.split('\n')
      if (leftLines[leftLines.length - 1] === '') leftLines.pop()
      const rightLines = nextPart.value.split('\n')
      if (rightLines[rightLines.length - 1] === '') rightLines.pop()

      const maxLen = Math.max(leftLines.length, rightLines.length)
      for (let j = 0; j < maxLen; j++) {
        rows.push({
          left: j < leftLines.length ? { text: leftLines[j], type: 'removed' } : { text: '', type: 'empty' },
          right: j < rightLines.length ? { text: rightLines[j], type: 'added' } : { text: '', type: 'empty' },
        })
      }
      i += 2
    } else if (part.removed) {
      const lines = part.value.split('\n')
      if (lines[lines.length - 1] === '') lines.pop()
      lines.forEach((l) => rows.push({ left: { text: l, type: 'removed' }, right: { text: '', type: 'empty' } }))
      i++
    } else if (part.added) {
      const lines = part.value.split('\n')
      if (lines[lines.length - 1] === '') lines.pop()
      lines.forEach((l) => rows.push({ left: { text: '', type: 'empty' }, right: { text: l, type: 'added' } }))
      i++
    } else {
      const lines = part.value.split('\n')
      if (lines[lines.length - 1] === '') lines.pop()
      lines.forEach((l) => rows.push({ left: { text: l, type: 'normal' }, right: { text: l, type: 'normal' } }))
      i++
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid grid-cols-2 border-b border-border bg-muted/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <div className="px-4 py-2.5 border-r border-border">Original PowerBuilder</div>
        <div className="px-4 py-2.5">Translated C#</div>
      </div>
      <div className="code-editor max-h-[650px] overflow-auto p-0 font-mono text-[12px] leading-relaxed">
        <table className="w-full border-collapse table-fixed">
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="group border-b border-border/5 last:border-0">
                <td
                  className={`
                    w-1/2 border-r border-border/40 px-4 py-0.5 align-top break-all whitespace-pre-wrap
                    ${
                      row.left.type === 'removed'
                        ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                        : row.left.type === 'empty'
                        ? 'bg-muted/5'
                        : 'text-muted-foreground/60'
                    }
                  `}
                >
                  <div className="flex gap-2">
                    <span className="w-3 shrink-0 select-none opacity-30">
                      {row.left.type === 'removed' ? '-' : ''}
                    </span>
                    <span>{row.left.text}</span>
                  </div>
                </td>
                <td
                  className={`
                    w-1/2 px-4 py-0.5 align-top break-all whitespace-pre-wrap
                    ${
                      row.right.type === 'added'
                        ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                        : row.right.type === 'empty'
                        ? 'bg-muted/5'
                        : 'text-foreground'
                    }
                  `}
                >
                  <div className="flex gap-2">
                    <span className="w-3 shrink-0 select-none opacity-30">
                      {row.right.type === 'added' ? '+' : ''}
                    </span>
                    <span>{row.right.text}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PipelineResultSection({ result, originalCode }: { result: PipelineResult, originalCode: string }) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('analysis')

  if (!result.analysis) {
    return null
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {(
          [
            { key: 'analysis' as const, label: 'Analysis' },
            { key: 'translation' as const, label: 'C#' },
            { key: 'diff' as const, label: 'Diff' },
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
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <span className="text-xs text-muted-foreground">Complexity</span>
              <span className="text-sm font-medium capitalize text-foreground">{result.analysis.complexity}</span>
            </div>
            <p className="text-[15px] leading-relaxed text-foreground">{result.analysis.explanation}</p>
            {result.analysis.key_components.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs text-muted-foreground">Key components</p>
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
        <div className="space-y-4">
          <CodeBlock code={result.translation.translated_code} language="csharp" />
          {result.translation.notes ? (
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Migration Notes</p>
              <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
                {result.translation.notes}
              </p>
            </div>
          ) : null}
        </div>
      )}

      {activeTab === 'diff' && result.translation && (
        <div className="space-y-4">
          <DiffView oldCode={originalCode} newCode={result.translation.translated_code} />
        </div>
      )}

      {activeTab === 'evaluation' && result.evaluation && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 grid gap-4 sm:grid-cols-2">
              <ScoreBar label="Faithfulness" score={result.evaluation.faithfulness_score} />
              <ScoreBar label="Idiomaticity" score={result.evaluation.idiomaticity_score} />
            </div>
            <span
              className={`inline-block rounded-full border px-2 py-1 text-xs font-medium ${riskClass(result.evaluation.risk_level)}`}
            >
              {result.evaluation.risk_level} risk
            </span>

            <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground mb-1">How scores are calculated</p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">Faithfulness (0-100):</span> Does the C# preserve ALL
                  PB business rules, DataWindow ops, and side effects?
                </li>
                <li>
                  <span className="font-medium text-foreground">Idiomaticity (0-100):</span> Does the C# feel like it
                  was written by a senior .NET 8 engineer? (async/await, LINQ, DI)
                </li>
                <li>
                  <span className="font-medium text-foreground">Risk:</span> Low = safe to deploy, Medium = needs
                  review, High = logic gaps detected
                </li>
              </ul>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs text-muted-foreground">Reviewer Summary</p>
              <p className="text-[15px] leading-relaxed text-foreground">{result.evaluation.reviewer_note}</p>
            </div>
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              {result.evaluation.strengths.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-foreground">Strengths</p>
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
                  <p className="mb-2 text-xs font-medium text-foreground">Issues</p>
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
        <div className="space-y-4">
          <CodeBlock code={result.tests.test_code} language="xUnit" />
          {result.tests.notes ? (
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="mb-2 text-xs text-muted-foreground">Coverage notes</p>
              <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">{result.tests.notes}</p>
            </div>
          ) : null}
        </div>
      )}
    </section>
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
  const [batchQueue, setBatchQueue] = useState<BatchQueueItem[]>([])
  const [batchRows, setBatchRows] = useState<BatchRow[]>([])
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const [dropHover, setDropHover] = useState(false)
  const dropDepth = useRef(0)

  const handleSampleSelect = useCallback((idx: number) => {
    setLegacyCode(SAMPLES[idx].code)
    setSourceLanguage(SAMPLES[idx].language)
  }, [])

  async function ingestPbFiles(fileList: File[]) {
    const picked = fileList.slice(0, 10)
    const allowed = picked.filter(
      (f) => f.name.toLowerCase().endsWith('.pb') || f.name.toLowerCase().endsWith('.pbl'),
    )
    if (allowed.length === 0) return
    if (allowed.length === 1) {
      const code = await allowed[0].text()
      setLegacyCode(code)
      setSourceLanguage('powerbuilder')
      setBatchQueue([])
    } else {
      const items: BatchQueueItem[] = await Promise.all(
        allowed.map(async (f) => ({ filename: f.name, code: await f.text() })),
      )
      setBatchQueue(items)
    }
  }

  async function handlePbFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files?.length) return
    await ingestPbFiles(Array.from(files))
    e.target.value = ''
  }

  function onDropZoneDragEnter(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dropDepth.current += 1
    setDropHover(true)
  }

  function onDropZoneDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dropDepth.current -= 1
    if (dropDepth.current <= 0) {
      dropDepth.current = 0
      setDropHover(false)
    }
  }

  function onDropZoneDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
  }

  function onDropZoneDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dropDepth.current = 0
    setDropHover(false)
    const fl = e.dataTransfer.files
    if (fl?.length) void ingestPbFiles(Array.from(fl))
  }

  async function runBatchFileStream(runId: string, fileIndex: number) {
    const res = await fetch(batchStreamUrl(runId, fileIndex), {
      headers: { Accept: 'text/event-stream' },
    })
    if (!res.ok) {
      const msg = await readErrorMessage(res)
      setBatchRows((prev) =>
        prev.map((r, i) =>
          i === fileIndex ? { ...r, stage: 'error', error: msg, progressPercent: 0 } : r,
        ),
      )
      return
    }
    const reader = res.body?.getReader()
    if (!reader) {
      setBatchRows((prev) =>
        prev.map((r, i) =>
          i === fileIndex ? { ...r, stage: 'error', error: 'No response body', progressPercent: 0 } : r,
        ),
      )
      return
    }
    let sawComplete = false
    await readSseStream(reader, (eventName, data) => {
      const rec = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
      if (eventName === 'status') {
        const st = rec.stage
        if (
          st === 'analyzing' ||
          st === 'translating' ||
          st === 'evaluating' ||
          st === 'testing'
        ) {
          const stage = st as Stage
          const pct =
            typeof rec.progress === 'number' ? Math.round(rec.progress) : stageToFallbackProgress(stage)
          setBatchRows((prev) =>
            prev.map((r, i) => (i === fileIndex ? { ...r, stage, progressPercent: pct } : r)),
          )
        }
      } else if (eventName === 'complete') {
        sawComplete = true
        const payload = rec.data
        if (payload && typeof payload === 'object') {
          try {
            const parsed = parseModernizePayload(payload as Record<string, unknown>)
            setBatchRows((prev) =>
              prev.map((r, i) =>
                i === fileIndex
                  ? {
                      ...r,
                      stage: 'done',
                      progressPercent: 100,
                      result: parsed,
                      error: undefined,
                      originalCode:
                        typeof (payload as { original_code?: string }).original_code === 'string'
                          ? (payload as { original_code: string }).original_code
                          : r.originalCode,
                    }
                  : r,
              ),
            )
          } catch (e) {
            const detail = e instanceof Error ? e.message : 'Invalid response'
            setBatchRows((prev) =>
              prev.map((r, i) =>
                i === fileIndex ? { ...r, stage: 'error', error: detail, result: null } : r,
              ),
            )
          }
        }
      } else if (eventName === 'error') {
        const msg = typeof rec.message === 'string' ? rec.message : 'Stream error'
        setBatchRows((prev) =>
          prev.map((r, i) =>
            i === fileIndex ? { ...r, stage: 'error', error: msg, progressPercent: 0 } : r,
          ),
        )
      }
    })
    if (!sawComplete) {
      setBatchRows((prev) =>
        prev.map((r, i) =>
          i === fileIndex && r.stage !== 'error' && r.stage !== 'done'
            ? { ...r, stage: 'error', error: 'Stream ended before completion', progressPercent: r.progressPercent }
            : r,
        ),
      )
    }
  }

  async function handleBatchRun() {
    if (batchQueue.length === 0) return

    setError('')
    setIsBatchRunning(true)
    const rows: BatchRow[] = batchQueue.map((q, i) => ({
      id: `batch-${Date.now()}-${i}`,
      filename: q.filename,
      stage: 'analyzing',
      progressPercent: 0,
      result: null,
      originalCode: q.code,
    }))
    setBatchRows(rows)

    try {
      const startRes = await fetch(migrateBatchStartUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: batchQueue.map((q) => ({
            filename: q.filename,
            code: q.code,
            source_language: 'powerbuilder',
          })),
        }),
      })

      if (!startRes.ok) {
        throw new Error(await readErrorMessage(startRes))
      }

      const startJson = (await startRes.json()) as { run_id?: string }
      const runId = startJson.run_id
      if (!runId) {
        throw new Error('Batch start did not return run_id')
      }

      await Promise.all(rows.map((_, fileIndex) => runBatchFileStream(runId, fileIndex)))
    } catch (err) {
      let msg = 'Unknown error'
      if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
        msg = 'Could not reach the server. Make sure the backend (uvicorn) is running on port 8000.'
      } else if (err instanceof Error) {
        msg = err.message
      }
      setError(msg)
      setBatchRows((prev) =>
        prev.map((r) =>
          r.stage === 'done'
            ? r
            : { ...r, stage: 'error' as Stage, error: msg, result: null, progressPercent: 0 },
        ),
      )
    } finally {
      setIsBatchRunning(false)
    }
  }

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

      setResult(parseModernizePayload(json))

      setStage('done')
    } catch (err) {
      let msg = 'Unknown error'
      if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
        msg = 'Could not reach the server. Make sure the backend (uvicorn) is running on port 8000.'
      } else if (err instanceof Error) {
        msg = err.message
      }
      setError(msg)
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

  const singleRunBusy = stage !== 'idle' && stage !== 'done' && stage !== 'error'
  const isBlocked = singleRunBusy || isBatchRunning
  const hasResult = stage === 'done' && result.analysis !== null
  const activeStageIdx = STAGES.findIndex((s) => s.key === stage)

  return (
    <main className="min-h-screen px-4 py-10 md:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-10">
        <header className="space-y-3">
          <p className="text-sm text-muted-foreground">Legacy code to C# (.NET 8)</p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">P2C</h1>
          <p className="max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Paste PowerBuilder code. Get analysis, idiomatic C# (.NET 8) with
            INotificationService integration, quality scoring, and xUnit tests.
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
                  disabled={isBlocked}
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label htmlFor="legacy-code-input" className="text-sm font-medium text-foreground">
                Your code
              </label>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <label
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-foreground hover:text-foreground"
                >Upload<input
                    type="file"
                    multiple
                    accept=".pb,.pbl"
                    onChange={handlePbFilesChange}
                    disabled={isBlocked}
                    aria-label="Upload .pb or .pbl files, up to 10 at once. One file loads into the editor; several queue for Run batch."
                    className="sr-only"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleBatchRun}
                  disabled={isBlocked || batchQueue.length === 0}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isBatchRunning ? 'Batch…' : 'Run batch'}
                </button>
                {batchQueue.length > 0 ? (
                  <span className="text-xs text-muted-foreground">{batchQueue.length} in queue</span>
                ) : null}
              </div>
            </div>
            <div
              onDragEnter={onDropZoneDragEnter}
              onDragLeave={onDropZoneDragLeave}
              onDragOver={onDropZoneDragOver}
              onDrop={onDropZoneDrop}
              className={`
                rounded-xl transition-colors
                ${
                  dropHover
                    ? 'border-2 border-dashed border-foreground bg-muted/40 p-1'
                    : 'border-2 border-dashed border-border p-1'
                }
              `}
            >
              <p
                className={`px-1 pb-2 text-center text-xs ${dropHover ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                {dropHover ? 'Drop .pb / .pbl files here' : 'Drag .pb or .pbl files here, or use Upload'}
              </p>
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="border-b border-border px-3 py-2">
                  <span className="font-mono text-xs text-muted-foreground">{sourceLanguage}</span>
                </div>
                <textarea
                  id="legacy-code-input"
                  value={legacyCode}
                  onChange={(e) => setLegacyCode(e.target.value)}
                  rows={16}
                  disabled={isBlocked}
                  className="code-editor code-surface w-full border-0 p-4 outline-none ring-0 disabled:opacity-60"
                  placeholder="Paste legacy code here."
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Language</span>
                <select
                  value={sourceLanguage}
                  onChange={(e) => setSourceLanguage(e.target.value)}
                  disabled={isBlocked}
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="powerbuilder">PowerBuilder</option>
                  <option value="cobol">COBOL</option>
                  <option value="vb6">VB6</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={isBlocked || !legacyCode.trim()}
                id="run-pipeline-btn"
                className="rounded-md bg-foreground px-5 py-2 text-sm font-medium text-background transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {singleRunBusy || isBatchRunning ? 'Working...' : 'Run'}
              </button>

              {hasResult && (
                <button
                  type="button"
                  onClick={handleDownloadReport}
                  className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition hover:border-foreground hover:text-foreground"
                >
                  Download notes
                </button>
              )}
            </div>
          </form>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-foreground/30 bg-muted px-4 py-3 text-sm text-foreground"
            >
              {error}
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-[1fr_minmax(200px,240px)]">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Progress
              </p>
              <ul className="space-y-3">
                {STAGES.map((s, i) => {
                  const isActive = s.key === stage
                  const isDone = hasResult || activeStageIdx > i
                  const { icon, colorClass } = progressIcon(s.key, isDone, isActive)
                  return (
                    <li key={s.key} className="flex items-center gap-3">
                      <span
                        className={`
                          flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium
                          ${colorClass}
                        `}
                      >
                        {isDone ? icon : isActive ? icon : i + 1}
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
              <div className="rounded-lg border border-border bg-card p-4">
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

        {hasResult && <PipelineResultSection result={result} originalCode={legacyCode} />}

        {batchRows.length > 0 && (
          <section className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Batch results</p>
            <div className="space-y-2">
              {batchRows.map((row) => {
                const fileDone = row.stage === 'done' && row.result?.analysis
                const fileErr = row.stage === 'error' || !!row.error
                const barPct = fileErr ? 0 : fileDone ? 100 : row.progressPercent
                return (
                  <details key={row.id} className="group rounded-lg border border-border bg-card open:shadow-sm">
                    <summary className="cursor-pointer list-none px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{row.filename}</span>
                        <span className="text-xs text-muted-foreground">
                          {fileErr ? 'Error' : fileDone ? 'Done' : isBatchRunning ? 'Working…' : row.stage}
                        </span>
                      </div>
                      <p className="mt-2 font-mono text-[11px] text-muted-foreground">{formatBatchRowStatus(row)}</p>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-foreground transition-[width] duration-300 ease-out"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </summary>
                    <div className="border-t border-border px-4 pb-4 pt-1">
                      {row.error ? (
                        <div
                          role="alert"
                          className="mt-2 rounded-md border border-foreground/20 bg-muted px-3 py-2 text-sm text-foreground"
                        >
                          {row.error}
                        </div>
                      ) : null}
                      {row.result?.analysis ? <PipelineResultSection result={row.result} originalCode={row.originalCode} /> : null}
                    </div>
                  </details>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
