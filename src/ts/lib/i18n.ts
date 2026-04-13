// i18n.ts
import { invoke } from '@tauri-apps/api/core'
import { useState, useEffect } from 'react';

const AVAILABLE_LANGS = ['ja', 'en'] as const;
type Lang = typeof AVAILABLE_LANGS[number];

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

const DEFAULT_LANG: Lang = AVAILABLE_LANGS[0]; // 'ja'

async function getLang(): Promise<Lang> {
  const lang = await invoke<string>('settings_get', { key: 'lang' })
  return (AVAILABLE_LANGS as readonly string[]).includes(lang)
    ? (lang as Lang)
    : DEFAULT_LANG;
}

async function getTranslatedText(key: string): Promise<string> {
  const data = await loadTranslationData();
  const item = data[key];
  if (!item) {
    console.warn(`Invalid translation key: ${key}`);
    return '';
  }
  const lang = await getLang();
  let text = item[lang] ?? item[DEFAULT_LANG];
  return text;
}

export function useMappedTranslations<T extends Record<string, string>>(
  mapping: T
): T {
  const localKeys = Object.keys(mapping) as (keyof T)[];
  const translationKeys = Object.values(mapping) as string[];

  const [translations, setTranslations] = useState<T>(
    () => Object.fromEntries(localKeys.map(k => [k, ''])) as T
  );

  const [lang, setLang] = useState<string>('ja');
  useEffect(() => {
    invoke<string>('settings_get', { key: 'lang' }).then(setLang);
  }, []);

  useEffect(() => {
    Promise.all(translationKeys.map(key => getTranslatedText(key))).then(values => {
      setTranslations(
        Object.fromEntries(localKeys.map((k, i) => [k, values[i]])) as T
      );
    });
  }, [lang]);

  return translations;
}