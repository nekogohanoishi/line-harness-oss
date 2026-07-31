import type { Metadata } from 'next'
import './globals.css'
import AppShell from '@/components/app-shell'
import { adminPath } from '@/lib/base-path'

// metadata.icons は next/link と違い basePath が自動で付かないため、
// public/ 配下のパスは adminPath() を通す。付け忘れると /admin 配信時に
// favicon が Worker のルート (/favicon.ico) を見て 404 になる。
export const metadata: Metadata = {
  title: 'L Harness',
  description: 'L Harness 管理画面',
  icons: {
    icon: [
      { url: adminPath('/favicon.ico'), sizes: 'any' },
      { url: adminPath('/favicon.svg'), type: 'image/svg+xml' },
    ],
    shortcut: [adminPath('/favicon.ico')],
    apple: [{ url: adminPath('/apple-touch-icon.png'), sizes: '180x180', type: 'image/png' }],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 text-gray-900 antialiased" style={{ fontFamily: "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', system-ui, sans-serif" }}>
        <AppShell>
          {children}
        </AppShell>
      </body>
    </html>
  )
}
