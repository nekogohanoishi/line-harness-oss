'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './layout/sidebar'
import UpdateBanner from './layout/update-banner'
import AuthGuard from './auth-guard'
import { AccountProvider } from '@/contexts/account-context'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/login') {
    return <>{children}</>
  }

  return (
    <AuthGuard>
      <AccountProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          {/* 上の余白はモバイル固定ヘッダの実高 (セーフエリア込み) と
              globals.css で同期している。数値を直接書かないこと。 */}
          {/* セーフエリア分は main 側の padding で足す。内側の div は
              Tailwind の px-/pb- を使うため、同じプロパティを自前 CSS で
              上書きすると余白が消える。 */}
          {/* min-w-0: これが無いと flex 子要素の min-width:auto により、
              幅の広い表が画面全体を押し広げてページごと横スクロールする。 */}
          <main className="flex-1 min-w-0 overflow-auto lh-app-header-offset lh-safe-x lh-safe-pb">
            <UpdateBanner />
            <div className="px-4 pt-4 pb-10 sm:px-6 lg:pt-8 lg:px-8 lg:pb-8">
              {children}
            </div>
          </main>
        </div>
      </AccountProvider>
    </AuthGuard>
  )
}
