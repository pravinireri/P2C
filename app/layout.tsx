import type { ReactNode } from 'react'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

export const metadata = {
  title: 'P2C',
  description:
    'PowerBuilder to C# (.NET 8) migration pipeline -- analysis, translation, quality scoring, and xUnit tests.',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="font-sans min-h-screen">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
