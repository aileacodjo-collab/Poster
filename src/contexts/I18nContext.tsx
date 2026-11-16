import React, { createContext, useContext, useState } from 'react';
import { UI_STRINGS, UiDictionary } from '../shared/i18n.ts';
import { Locale } from '../shared/types.ts';

interface I18nContextValue {
  locale: Locale;
  setLocale: (loc: Locale) => void;
  t: UiDictionary;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'fr',
  setLocale: () => {},
  t: UI_STRINGS.fr,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // French ('fr') is the mandatory default authoring and interface language
  const [locale, setLocaleState] = useState<Locale>('fr');

  const setLocale = (loc: Locale) => {
    setLocaleState(loc);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = loc;
    }
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t: UI_STRINGS[locale] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
