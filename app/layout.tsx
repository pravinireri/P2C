import type { ReactNode } from 'react'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

export const metadata = {
  title: 'P2C Modernizer — AI-Powered Legacy Code Migration',
  description:
    'Transform PowerBuilder, COBOL, and VB6 into idiomatic C# .NET 8 with AI-driven analysis, translation, self-evaluation, and test generation.',
  openGraph: {
    title: 'P2C Modernizer',
    description: 'AI-powered legacy code migration pipeline',
    type: 'website',
  },
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased bg-background text-foreground">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
