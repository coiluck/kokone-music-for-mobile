// i18n.ts
import { useState, useEffect } from 'react';
import { useSettingsStore, AVAILABLE_LANGS } from './settingsStore'

type Lang = typeof AVAILABLE_LANGS[number]

interface TranslationItem extends Record<Lang, string> {}
interface TranslationData {
  [key: string]: TranslationItem;
}

// ── internal ──────────────────────────────────────────────
let translationData: TranslationData | null = null;
let fetchPromise: Promise<TranslationData> | null = null;

async function loadTranslationData(): Promise<TranslationData> {
  if (translationData) return translationData;
  if (!fetchPromise) {
    fetchPromise = fetch('/json/translation.json')
      .then(res => res.json() as Promise<TranslationData>)
      .then(data => {
        translationData = data;
        return data;
      });
  }
  return fetchPromise;
}

const DEFAULT_LANG: Lang = AVAILABLE_LANGS[0]; // 'en'

async function getTranslatedText(key: string, lang: Lang): Promise<string> {
  const data = await loadTranslationData()
  const item = data[key]
  if (!item) {
    console.warn(`Invalid translation key: ${key}`)
    return ''
  }
  return item[lang] ?? item[DEFAULT_LANG]
}

export function useMappedTranslations<T extends Record<string, string>>(
  mapping: T
): T {
  const localKeys = Object.keys(mapping) as (keyof T)[]
  const translationKeys = Object.values(mapping) as string[]

  // ストアの lang を購読 → 変化したら自動で再翻訳
  const lang = useSettingsStore(s => s.lang)

  const [translations, setTranslations] = useState<T>(
    () => Object.fromEntries(localKeys.map(k => [k, ''])) as T
  )

  useEffect(() => {
    Promise.all(translationKeys.map(key => getTranslatedText(key, lang))).then(values => {
      setTranslations(
        Object.fromEntries(localKeys.map((k, i) => [k, values[i]])) as T
      )
    })
  }, [lang])

  return translations
}