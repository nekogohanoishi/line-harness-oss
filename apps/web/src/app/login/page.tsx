'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

type LoginResponse = {
  success?: boolean
  data?: {
    name: string
    role: string
  }
  csrfToken?: string
  error?: string
}

export default function LoginPage() {
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL
      if (!apiUrl) {
        setError('NEXT_PUBLIC_API_URL is not set in build env')
        setLoading(false)
        return
      }
      const res = await fetch(`${apiUrl}/api/admin-auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      })

      let loginData: LoginResponse | null = null
      try {
        loginData = await res.json()
      } catch {
        loginData = null
      }

      if (res.ok && loginData?.success && loginData?.data) {
        localStorage.removeItem('lh_api_key')
        localStorage.setItem('lh_staff_name', loginData.data.name)
        localStorage.setItem('lh_staff_role', loginData.data.role)
        if (loginData.csrfToken) {
          localStorage.setItem('lh_csrf', loginData.csrfToken)
        }
        router.push('/')
      } else if (res.status === 401 || loginData?.error === 'Unauthorized') {
        setError('APIキーが正しくありません')
      } else {
        let message = 'ログインに失敗しました'
        if (loginData?.error) message = loginData.error
        setError(message)
      }
    } catch {
      setError('接続に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#06C755' }}>
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg mx-auto mb-3" style={{ backgroundColor: '#06C755' }}>
            H
          </div>
          <h1 className="text-xl font-bold text-gray-900">L Harness</h1>
          <p className="text-sm text-gray-500 mt-1">管理画面にログイン</p>
        </div>

        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="APIキーを入力"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 mb-4">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !apiKey}
            className="w-full py-3 text-white font-medium rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  )
}
