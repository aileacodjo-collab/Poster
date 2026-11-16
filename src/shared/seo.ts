import {
  HREFLANG_LOCALES,
  Locale,
  Post,
  PostTranslation,
  SEOSetting,
} from './types.ts';

export interface ResolvedPostSEO {
  title: string;
  description: string;
  canonicalUrl: string;
  ogTitle: string;
  ogDescription: string;
  ogImageUrl: string;
  ogLocale: string;
  twitterCard: 'summary' | 'summary_large_image';
  noIndex: boolean;
  hreflangs: Array<{ hreflang: string; href: string }>;
  jsonLd: Record<string, unknown>;
}

export function isSafeHttpUrl(url: string | null | undefined): boolean {
  if (!url || !url.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isSafeAssetOrHttpUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return !/[\r\n\0]/.test(trimmed);
  }
  return isSafeHttpUrl(trimmed);
}

export function buildPublicPostPath(locale: Locale, slug: string): string {
  return `/p/${locale}/${encodeURIComponent(slug)}`;
}

export function buildAbsoluteUrl(baseUrl: string, path: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${normalizedPath}`;
}

export function resolvePostSEO(params: {
  baseUrl: string;
  brandName: string;
  post: Post;
  locale: Locale;
  translation: PostTranslation;
  allTranslations: Record<Locale, PostTranslation | null>;
  seoSetting: SEOSetting | null;
}): ResolvedPostSEO {
  const { baseUrl, brandName, post, locale, translation, allTranslations, seoSetting } = params;
  const currentUrl = buildAbsoluteUrl(baseUrl, buildPublicPostPath(locale, translation.slug));

  const title = seoSetting?.metaTitle?.trim() || `${translation.title} — ${brandName}`;
  const description = seoSetting?.metaDescription?.trim() || translation.excerpt || translation.title;
  const rawCanonical = seoSetting?.canonicalUrl?.trim();
  const canonicalUrl = rawCanonical && isSafeHttpUrl(rawCanonical) ? rawCanonical : currentUrl;
  const ogTitle = seoSetting?.ogTitle?.trim() || title;
  const ogDescription = seoSetting?.ogDescription?.trim() || description;
  const rawImageCandidate = seoSetting?.ogImageUrl?.trim() || post.featuredImageUrl || '';
  const rawImage = isSafeAssetOrHttpUrl(rawImageCandidate) ? rawImageCandidate : '';
  const ogImageUrl = rawImage.startsWith('http')
    ? rawImage
    : rawImage
      ? buildAbsoluteUrl(baseUrl, rawImage)
      : '';

  // CRITICAL: Only emit reciprocal hreflang annotations for supported French ('fr') and English ('en') variants
  // that are actually published with content. Never emit unsupported Fongbe ('fon') hreflang codes.
  const isPublishedVariantReady = (tr: PostTranslation | null, loc: Locale): tr is PostTranslation => {
    if (!tr || !tr.slug?.trim() || !tr.title?.trim() || !tr.markdownContent?.trim()) return false;
    if (loc === 'fon' && tr.translationStatus !== 'approved') return false;
    return true;
  };

  const hreflangs: Array<{ hreflang: string; href: string }> = [];
  if (locale === 'fr' || locale === 'en') {
    for (const altLoc of HREFLANG_LOCALES) {
      const altTr = allTranslations[altLoc];
      if (isPublishedVariantReady(altTr, altLoc)) {
        hreflangs.push({
          hreflang: altLoc,
          href: buildAbsoluteUrl(baseUrl, buildPublicPostPath(altLoc, altTr.slug)),
        });
      }
    }
    const defaultTr = isPublishedVariantReady(allTranslations.fr, 'fr')
      ? allTranslations.fr
      : isPublishedVariantReady(allTranslations.en, 'en')
        ? allTranslations.en
        : null;
    if (defaultTr) {
      const defaultLoc = defaultTr.locale;
      hreflangs.push({
        hreflang: 'x-default',
        href: buildAbsoluteUrl(baseUrl, buildPublicPostPath(defaultLoc, defaultTr.slug)),
      });
    }
  }

  const ogLocale = locale === 'fr' ? 'fr_FR' : locale === 'en' ? 'en_US' : 'fon_BJ';

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': seoSetting?.schemaType || 'BlogPosting',
    headline: translation.title,
    description,
    inLanguage: locale,
    datePublished: post.publishedAt || post.createdAt,
    dateModified: translation.updatedAt || post.updatedAt,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': canonicalUrl,
    },
    author: {
      '@type': 'Person',
      name: post.authorName || brandName,
    },
    publisher: {
      '@type': 'Organization',
      name: brandName,
    },
  };

  if (ogImageUrl) {
    jsonLd.image = [ogImageUrl];
  }

  return {
    title,
    description,
    canonicalUrl,
    ogTitle,
    ogDescription,
    ogImageUrl,
    ogLocale,
    twitterCard: seoSetting?.twitterCardType || (ogImageUrl ? 'summary_large_image' : 'summary'),
    noIndex: Boolean(seoSetting?.noIndex),
    hreflangs,
    jsonLd,
  };
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildXmlSitemap(params: {
  baseUrl: string;
  entries: Array<{
    post: Post;
    translations: Record<Locale, PostTranslation | null>;
  }>;
}): string {
  const { baseUrl, entries } = params;
  const urls: string[] = [];

  for (const loc of ['fr', 'en', 'fon'] as Locale[]) {
    urls.push(
      `  <url>\n    <loc>${escapeXml(buildAbsoluteUrl(baseUrl, `/p/${loc}`))}</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`
    );
  }

  for (const item of entries) {
    if (item.post.status !== 'published') continue;
    for (const loc of ['fr', 'en', 'fon'] as Locale[]) {
      const tr = item.translations[loc];
      if (!tr || !tr.slug?.trim() || !tr.title?.trim() || !tr.markdownContent?.trim()) continue;
      if (loc === 'fon' && tr.translationStatus !== 'approved') continue;

      const locUrl = buildAbsoluteUrl(baseUrl, buildPublicPostPath(loc, tr.slug));
      let xhtmlLinks = '';
      if (loc === 'fr' || loc === 'en') {
        for (const altLoc of HREFLANG_LOCALES) {
          const altTr = item.translations[altLoc];
          if (altTr && altTr.slug?.trim() && altTr.title?.trim() && altTr.markdownContent?.trim()) {
            const altUrl = buildAbsoluteUrl(baseUrl, buildPublicPostPath(altLoc, altTr.slug));
            xhtmlLinks += `\n    <xhtml:link rel="alternate" hreflang="${altLoc}" href="${escapeXml(altUrl)}" />`;
          }
        }
      }

      const lastmod = (tr.updatedAt || item.post.updatedAt || item.post.publishedAt || new Date().toISOString()).slice(0, 10);
      urls.push(
        `  <url>\n    <loc>${escapeXml(locUrl)}</loc>\n    <lastmod>${escapeXml(lastmod)}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>${xhtmlLinks}\n  </url>`
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>`;
}

export function buildRobotsTxt(baseUrl: string): string {
  const sitemapUrl = buildAbsoluteUrl(baseUrl, '/sitemap.xml');
  return `User-agent: *\nAllow: /\nAllow: /p/\nDisallow: /api/admin/\n\nSitemap: ${sitemapUrl}\n`;
}
