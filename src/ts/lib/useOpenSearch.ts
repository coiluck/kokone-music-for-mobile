import { useLocation, useNavigate } from 'react-router-dom'

// 検索ページへ遷移する。スマホは HeaderApp、PC は Sidebar から呼ぶ
export function useOpenSearch() {
  const location = useLocation()
  const navigate = useNavigate()

  return () => {
    if (location.pathname === '/sub/search') {
      // 再度inputにfocusを合わせるため
      navigate('/sub/search', {
        replace: true,
        state: { ...location.state, initialTags: [] }, // from / scrollTop を引き継ぐ
      })
      return
    }
    const pageEl = document.querySelector('.page')
    const scrollTop = pageEl?.scrollTop ?? 0
    navigate('/sub/search', {
      state: { from: location.pathname, scrollTop },
    })
  }
}
