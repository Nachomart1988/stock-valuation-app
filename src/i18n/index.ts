import en from './locales/en.json';
import es from './locales/es.json';

export type Locale = 'en' | 'es';

export const locales: Record<Locale, typeof en> = {
  en,
  es,
};

export const defaultLocale: Locale = 'es';

export const localeNames: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
};

export const localeFlags: Record<Locale, string> = {
  en: '🇺🇸',
  es: '🇪🇸',
};

// Type for nested object access
type NestedKeyOf<ObjectType extends object> = {
  [Key in keyof ObjectType & (string | number)]: ObjectType[Key] extends object
    ? `${Key}` | `${Key}.${NestedKeyOf<ObjectType[Key]>}`
    : `${Key}`;
}[keyof ObjectType & (string | number)];

export type TranslationKey = NestedKeyOf<typeof en>;

// Helper to get nested value from object
export function getNestedValue(obj: any, path: string): string {
  const keys = path.split('.');
  let result = obj;

  for (const key of keys) {
    if (result && typeof result === 'object' && key in result) {
      result = result[key];
    } else {
      return path; // Return the key if not found
    }
  }

  return typeof result === 'string' ? result : path;
}

// Get translation function
export function createTranslator(locale: Locale) {
  const translations = locales[locale];

  return function t(key: string, params?: Record<string, string | number>): string {
    let text = getNestedValue(translations, key);

    if (params) {
      Object.entries(params).forEach(([paramKey, value]) => {
        text = text.replace(new RegExp(`{{${paramKey}}}`, 'g'), String(value));
      });
    }

    return text;
  };
}
