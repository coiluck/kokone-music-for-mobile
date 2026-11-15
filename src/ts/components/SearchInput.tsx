import type { Dispatch, Ref, SetStateAction } from 'react'
import { useMappedTranslations } from '../lib/i18n'
import '../../css/pages/sub/SearchPage.css'

interface Props {
  query: string
  setQuery: Dispatch<SetStateAction<string>>
  tags: string[]
  setTags: Dispatch<SetStateAction<string[]>>
  inputRef?: Ref<HTMLInputElement>
}

// タグ付きの検索欄。Enter で入力をタグにする
export default function SearchInput({ query, setQuery, tags, setTags, inputRef }: Props) {
  const t = useMappedTranslations({
    placeholder: 'search.input.placeholder',
  })

  const handleClear = () => {
    setQuery('')
    setTags([])
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key !== 'Enter') return

    const value = query.trim()
    if (!value) return
    if (tags.includes(value)) {
      setQuery('')
      return
    }

    setTags(prev => [...prev, value])
    setQuery('')
  }

  return (
    <div className="search-page-input-container">
      <div className="search-page-input-tags-container">
        {tags.map(tag => (
          <span
            key={tag}
            className="search-page-input-tags-item"
            onClick={() => setTags(prev => prev.filter(t => t !== tag))}
          >
            {tag}
          </span>
        ))}
      </div>
      <input
        ref={inputRef}
        className="search-page-input"
        type="text"
        placeholder={t.placeholder}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div
        className="search-page-input-clear"
        onClick={handleClear}
      />
    </div>
  )
}
