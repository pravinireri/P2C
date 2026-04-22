import { NextRequest, NextResponse } from 'next/server'

function backendBaseUrl(): string {
  const fromEnv =
    process.env.BACKEND_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    'http://127.0.0.1:8000'
  return fromEnv.replace(/\/$/, '')
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ runId: string; fileIndex: string }> },
) {
  const { runId, fileIndex } = await context.params
  const target = `${backendBaseUrl()}/stream/${encodeURIComponent(runId)}/${encodeURIComponent(fileIndex)}`

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      cache: 'no-store',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upstream request failed'
    return NextResponse.json(
      {
        detail: `Could not reach the API at ${target}. Start the backend (uvicorn) or set BACKEND_URL. ${msg}`,
      },
      { status: 502 },
    )
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text()
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') || 'text/plain' },
    })
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
