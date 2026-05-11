import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import es from './es.json';

export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    nonExplicitSupportedLngs: true,
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'halma_lang',
    },
  });

function applyHtmlLang(lng: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lng.split('-')[0] ?? 'en';
}

applyHtmlLang(i18n.language);
i18n.on('languageChanged', applyHtmlLang);

export function currentLocale(): Locale {
  const base = (i18n.language || 'en').split('-')[0] as Locale;
  return (SUPPORTED_LOCALES as readonly string[]).includes(base) ? base : 'en';
}

export default i18n;
