import { NextRequest, NextResponse } from 'next/server'

function backendBaseUrl(): string {
  const fromEnv =
    process.env.BACKEND_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    'http://127.0.0.1:8000'
  return fromEnv.replace(/\/$/, '')
}

export async function POST(req: NextRequest) {
  let body: string
  try {
    body = await req.text()
  } catch {
    return NextResponse.json({ detail: 'Invalid request body' }, { status: 400 })
  }

  const target = `${backendBaseUrl()}/modernize`
  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
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

  const text = await upstream.text()
  const contentType = upstream.headers.get('content-type') || 'application/json'
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'Content-Type': contentType },
  })
}
