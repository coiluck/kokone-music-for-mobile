import { useLocation, useNavigate } from 'react-router-dom'

// 検索ページへ遷移する。スマホは HeaderApp、PC は Sidebar から呼ぶ
export function useOpenSearch() {
  const location = useLocation()
  const navigate = useNavigate()

  return () => {
    // 検索ページでは input に focus を合わせ直すだけなので履歴を増やさない
    navigate('/sub/search', { replace: location.pathname === '/sub/search' })
  }
}
