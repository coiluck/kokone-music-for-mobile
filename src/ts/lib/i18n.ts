// i18n.ts
import { useEffect, useMemo, useState } from 'react'
import { useSettingsStore, DEFAULT_LANG, type Lang } from './settingsStore'

// 型だけを取り出すための import。ビルド時に完全に消えるので実行時の影響はない
import type translationJson from '../../../public/json/translation.json'

export type TranslationKey = keyof typeof translationJson

type TranslationItem = Partial<Record<Lang, string>>
type TranslationData = Partial<Record<TranslationKey, TranslationItem>>

const TRANSLATION_URL = '/json/translation.json'

let cache: TranslationData | null = null
let fetchPromise: Promise<TranslationData> | null = null

function loadTranslationData(): Promise<TranslationData> {
  if (cache) return Promise.resolve(cache)

  fetchPromise ??= fetch(TRANSLATION_URL)
    .then(res => {
      if (!res.ok) throw new Error(`Failed to load translations: ${res.status}`)
      return res.json() as Promise<TranslationData>
    })
    .then(data => {
      cache = data
      return data
    })
    .catch(err => {
      fetchPromise = null
      throw err
    })

  return fetchPromise
}

function translate(data: TranslationData, key: TranslationKey, lang: Lang): string {
  const item = data[key]
  if (!item) {
    console.warn(`Invalid translation key: ${key}`)
    return ''
  }
  return item[lang] ?? item[DEFAULT_LANG] ?? ''
}

// 翻訳データを一度だけ読み込んでキャッシュ
function useTranslationData(): TranslationData | null {
  const [data, setData] = useState<TranslationData | null>(cache)

  useEffect(() => {
    if (data) return
    let active = true
    loadTranslationData()
      .then(d => { if (active) setData(d) })
      .catch(err => console.error(err))
    return () => { active = false }
  }, [data])

  return data
}

// これだけ公開
export function useMappedTranslations<T extends Record<string, TranslationKey>>(
  mapping: T
): Record<keyof T, string> {
  // ストアの lang を購読 → 変化したら自動で再翻訳
  const lang = useSettingsStore(s => s.lang)
  const data = useTranslationData()

  // mapping は呼び出し側で毎回作られるオブジェクトなので、中身が変わったときだけ再計算する
  const mappingKey = JSON.stringify(mapping)

  return useMemo(() => {
    const entries = Object.entries(mapping) as [keyof T, TranslationKey][]
    return Object.fromEntries(
      entries.map(([name, key]) => [name, data ? translate(data, key, lang) : ''])
    ) as Record<keyof T, string>
  }, [data, lang, mappingKey])
}