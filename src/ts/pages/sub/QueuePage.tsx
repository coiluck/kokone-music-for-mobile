import { useNavigate, useLocation } from 'react-router-dom'
import { useMappedTranslations } from '../../lib/i18n'

export default function QueuePage() {
  const navigate = useNavigate()
  const location = useLocation()

  // App.tsx 側で MiniPlayer の List ボタンが渡してくれる
  const from = (location.state?.from as string | undefined) ?? '/'
  const scrollTop = (location.state?.scrollTop as number | undefined) ?? 0

  const t = useMappedTranslations({
    title: 'page.queue', // 必要なら i18n キーを差し替えてください
  })

  const handleBack = () => {
    // replace: true がポイント。
    // - これにより /queue の履歴エントリは from で上書きされる
    // - 戻った先で OS の戻る（back）を押しても /queue には戻らない
    // - restoreScrollTop は App.tsx 側の useEffect が拾ってスクロール復元する
    navigate(from, {
      replace: true,
      state: { restoreScrollTop: scrollTop },
    })
  }

  return (
    // 他ページと同じく .page を付けることで、App 側のスクロール領域に収まる
    <div className="page queue-page">
      <div className="queue-page-header">
        <button
          className="queue-page-back-button"
          onClick={handleBack}
          aria-label="back"
        />
        <h2>{t.title ?? 'Queue'}</h2>
      </div>

      {/* TODO: 実際のキューリスト UI */}
      <div className="queue-page-list">
        {/* ここに usePlayerStore からキューを取り出して並べる */}
      </div>
    </div>
  )
}