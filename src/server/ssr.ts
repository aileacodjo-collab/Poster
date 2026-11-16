import { LOCALE_META, UI_STRINGS } from '../shared/i18n.ts';
import { buildAbsoluteUrl, buildPublicPostPath, isSafeAssetOrHttpUrl, resolvePostSEO } from '../shared/seo.ts';
import {
  Category,
  FullPostBundle,
  Locale,
  Post,
  PostReaction,
  PostTranslation,
  SUPPORTED_LOCALES,
  Workspace,
} from '../shared/types.ts';

function escHtml(str: string | null | undefined): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso: string | null, locale: Locale): string {
  if (!iso) return '';
  try {
    const loc = locale === 'fon' ? 'fr-BJ' : locale === 'fr' ? 'fr-FR' : 'en-US';
    return new Intl.DateTimeFormat(loc, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

const SHARED_SSR_STYLES = `
  :root {
    --ailea-emerald: #006B35;
    --ailea-emerald-hover: #00552A;
    --ailea-mint: #E5F3EA;
    --ailea-canvas: #F1F4F6;
    --ailea-ink: #17191C;
    --ailea-muted: #525866;
    --ailea-border: #DFE5EC;
    --ailea-surface: #FFFFFF;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    background: var(--ailea-canvas);
    color: var(--ailea-ink);
    font-family: 'Plus Jakarta Sans', 'Noto Sans', system-ui, -apple-system, sans-serif;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .clay-card {
    background: var(--ailea-surface);
    border-radius: 16px;
    border: 1px solid var(--ailea-border);
    box-shadow: 0 10px 28px -12px rgba(23, 25, 28, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9);
  }
  .clay-control {
    border-radius: 10px;
    min-height: 48px;
    transition: transform 160ms cubic-bezier(0.16, 1, 0.3, 1), background-color 160ms ease, border-color 160ms ease;
  }
  .clay-control:focus-visible {
    outline: 2px solid var(--ailea-emerald);
    outline-offset: 2px;
  }
  .topbar {
    background: rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--ailea-border);
  }
  .topbar-inner {
    max-width: 1080px;
    margin: 0 auto;
    padding: 12px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .brand-mark {
    font-weight: 700;
    font-size: 1.05rem;
    letter-spacing: -0.02em;
    color: var(--ailea-ink);
    text-decoration: none;
    white-space: nowrap;
  }
  .lang-switcher {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .lang-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 14px;
    border-radius: 10px;
    font-size: 0.875rem;
    font-weight: 600;
    text-decoration: none;
    color: var(--ailea-muted);
    border: 1px solid transparent;
    white-space: nowrap;
  }
  .lang-link:hover {
    background: #FFFFFF;
    color: var(--ailea-ink);
    border-color: var(--ailea-border);
  }
  .lang-link[aria-current="page"] {
    background: var(--ailea-mint);
    color: var(--ailea-emerald);
    border-color: #B8DFC6;
  }
  .container-reading {
    max-width: 780px;
    margin: 0 auto;
    padding: 28px 16px 64px;
  }
  .article-title {
    font-family: 'Lora', 'Noto Sans', Georgia, serif;
    font-size: clamp(1.85rem, 3.8vw, 2.75rem);
    line-height: 1.2;
    font-weight: 700;
    letter-spacing: -0.015em;
    color: var(--ailea-ink);
    margin: 0 0 16px;
    text-wrap: balance;
  }
  .meta-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    font-size: 0.875rem;
    color: var(--ailea-muted);
    margin-bottom: 24px;
  }
  .cover-frame {
    border-radius: 16px;
    overflow: hidden;
    margin: 0 0 32px;
    background: #E4EAE6;
    aspect-ratio: 16 / 9;
  }
  .cover-frame img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .editorial-prose {
    font-family: 'Lora', 'Noto Sans', Georgia, serif;
    font-size: 1.125rem;
    line-height: 1.78;
    color: #20242A;
    max-width: 68ch;
  }
  .editorial-prose h2, .editorial-prose h3, .editorial-prose h4 {
    font-family: 'Plus Jakarta Sans', 'Noto Sans', sans-serif;
    color: var(--ailea-ink);
    margin-top: 2em;
    margin-bottom: 0.65em;
    line-height: 1.3;
  }
  .editorial-prose h2 { font-size: 1.5rem; font-weight: 700; }
  .editorial-prose h3 { font-size: 1.25rem; font-weight: 600; }
  .editorial-prose p { margin: 0 0 1.25em; }
  .editorial-prose a { color: var(--ailea-emerald); text-decoration: underline; text-underline-offset: 3px; }
  .editorial-prose blockquote {
    margin: 1.6em 0;
    padding: 18px 22px;
    background: var(--ailea-mint);
    border-radius: 12px;
    font-style: italic;
    color: #133924;
  }
  .editorial-prose blockquote p:last-child { margin-bottom: 0; }
  .editorial-prose pre {
    background: #17191C;
    color: #F1F4F6;
    padding: 16px 18px;
    border-radius: 12px;
    overflow-x: auto;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.88rem;
    line-height: 1.55;
  }
  .editorial-prose code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.88em;
    background: #E8EDF1;
    padding: 2px 6px;
    border-radius: 6px;
  }
  .editorial-prose pre code { background: transparent; padding: 0; }
  .editorial-prose table {
    width: 100%;
    border-collapse: collapse;
    margin: 1.5em 0;
    font-family: 'Plus Jakarta Sans', 'Noto Sans', sans-serif;
    font-size: 0.92rem;
    overflow-x: auto;
    display: block;
  }
  .editorial-prose th, .editorial-prose td {
    border-bottom: 1px solid var(--ailea-border);
    padding: 10px 12px;
    text-align: left;
  }
  .editorial-prose th { font-weight: 600; color: var(--ailea-ink); background: #F8FAFB; }
  .editorial-prose ul, .editorial-prose ol { padding-left: 1.4em; margin: 0 0 1.25em; }
  .editorial-prose li { margin-bottom: 0.45em; }
  .editorial-prose img { max-width: 100%; border-radius: 12px; height: auto; }
  .reaction-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 16px;
  }
  .reaction-btn {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 56px;
    min-width: 48px;
    padding: 0 18px;
    border-radius: 10px;
    border: 1px solid var(--ailea-border);
    background: #FFFFFF;
    color: var(--ailea-ink);
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 12px -4px rgba(23, 25, 28, 0.08);
    transition: transform 150ms ease, background-color 150ms ease, border-color 150ms ease;
  }
  .reaction-btn:hover {
    transform: translateY(-1px);
    border-color: #9CBFA9;
    background: #F9FCFA;
  }
  .reaction-btn[aria-pressed="true"] {
    background: var(--ailea-mint);
    border-color: var(--ailea-emerald);
    color: var(--ailea-emerald);
  }
  .reaction-count {
    font-variant-numeric: tabular-nums;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.85rem;
    opacity: 0.85;
  }
  .action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 48px;
    padding: 0 18px;
    border-radius: 10px;
    border: 1px solid var(--ailea-border);
    background: #FFFFFF;
    color: var(--ailea-ink);
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .action-btn-primary {
    background: var(--ailea-emerald);
    border-color: var(--ailea-emerald);
    color: #FFFFFF;
    min-height: 56px;
    padding: 0 22px;
  }
  .action-btn-primary:hover { background: var(--ailea-emerald-hover); }
  .tabular { font-variant-numeric: tabular-nums; }
`;

export function renderPublicPostHtml(params: {
  baseUrl: string;
  workspace: Workspace;
  bundle: FullPostBundle;
  locale: Locale;
  category: Category | null;
  activeReactionKeys: string[];
  relatedPosts: Array<{
    locale: Locale;
    title: string;
    slug: string;
    excerpt: string;
    publishedAt: string | null;
  }>;
}): string {
  const { baseUrl, workspace, bundle, locale, category, activeReactionKeys, relatedPosts } = params;
  const translation = bundle.translations[locale];
  if (!translation) return renderNotFoundHtml(locale, baseUrl);

  const dict = UI_STRINGS[locale];
  const seo = resolvePostSEO({
    baseUrl,
    brandName: workspace.brandName,
    post: bundle.post,
    locale,
    translation,
    allTranslations: bundle.translations,
    seoSetting: bundle.seo[locale],
  });

  const currentPath = buildPublicPostPath(locale, translation.slug);
  const enabledReactions = bundle.reactions.filter((r) => r.enabled).sort((a, b) => a.displayOrder - b.displayOrder);

  // Language switcher links — link only to available & approved translations
  const languageLinksHtml = SUPPORTED_LOCALES.map((loc) => {
    const tr = bundle.translations[loc];
    if (!tr || !tr.title || !tr.slug) return '';
    if (loc === 'fon' && tr.translationStatus !== 'approved') return '';
    const href = buildPublicPostPath(loc, tr.slug);
    const isCurrent = loc === locale;
    const hreflangAttr = loc === 'fon' ? '' : ` hreflang="${loc}"`;
    return `<a href="${escHtml(href)}" class="lang-link"${isCurrent ? ' aria-current="page"' : ''}${hreflangAttr}>${escHtml(LOCALE_META[loc].nativeName)}</a>`;
  })
    .filter(Boolean)
    .join('\n          ');

  const hreflangTagsHtml = seo.hreflangs
    .map((h) => `  <link rel="alternate" hreflang="${escHtml(h.hreflang)}" href="${escHtml(h.href)}" />`)
    .join('\n');

  const reactionFormsHtml = enabledReactions
    .map((reaction) => {
      const isSelected = activeReactionKeys.includes(reaction.semanticKey);
      const label = reaction.labels[locale] || reaction.semanticKey;
      return `
        <form method="POST" action="/api/public/reactions/form" class="reaction-form" data-reaction-key="${escHtml(reaction.semanticKey)}">
          <input type="hidden" name="postId" value="${escHtml(bundle.post.id)}" />
          <input type="hidden" name="locale" value="${escHtml(locale)}" />
          <input type="hidden" name="slug" value="${escHtml(translation.slug)}" />
          <input type="hidden" name="semanticKey" value="${escHtml(reaction.semanticKey)}" />
          <input type="hidden" name="redirectTo" value="${escHtml(currentPath)}" />
          <button type="submit" class="reaction-btn" aria-pressed="${isSelected ? 'true' : 'false'}" data-key="${escHtml(reaction.semanticKey)}">
            <span aria-hidden="true" style="font-size:1.35rem;line-height:1;">${escHtml(reaction.emoji)}</span>
            <span>${escHtml(label)}</span>
            <span class="reaction-count tabular">${reaction.count}</span>
          </button>
        </form>`;
    })
    .join('\n');

  const relatedHtml =
    relatedPosts.length > 0
      ? `
      <section style="margin-top:40px;" aria-label="${escHtml(dict.publicReader.relatedArticles)}">
        <h2 style="font-size:1.25rem;font-weight:700;margin:0 0 16px;">${escHtml(dict.publicReader.relatedArticles)}</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;">
          ${relatedPosts
            .map(
              (rp) => `
            <a href="${escHtml(buildPublicPostPath(rp.locale, rp.slug))}" class="clay-card" style="display:block;padding:20px;text-decoration:none;color:inherit;">
              <div style="font-weight:700;font-size:1.05rem;line-height:1.35;margin-bottom:8px;color:var(--ailea-ink);">${escHtml(rp.title)}</div>
              <div style="font-size:0.875rem;color:var(--ailea-muted);line-height:1.5;">${escHtml(rp.excerpt)}</div>
            </a>`
            )
            .join('')}
        </div>
      </section>`
      : '';

  return `<!doctype html>
<html lang="${escHtml(locale)}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(seo.title)}</title>
  <meta name="description" content="${escHtml(seo.description)}" />
  ${seo.noIndex ? '<meta name="robots" content="noindex, nofollow" />' : '<meta name="robots" content="index, follow" />'}
  <link rel="canonical" href="${escHtml(seo.canonicalUrl)}" />
${hreflangTagsHtml}
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="${escHtml(workspace.brandName)}" />
  <meta property="og:title" content="${escHtml(seo.ogTitle)}" />
  <meta property="og:description" content="${escHtml(seo.ogDescription)}" />
  <meta property="og:url" content="${escHtml(seo.canonicalUrl)}" />
  <meta property="og:locale" content="${escHtml(seo.ogLocale)}" />
  ${seo.ogImageUrl ? `<meta property="og:image" content="${escHtml(seo.ogImageUrl)}" />` : ''}
  <meta name="twitter:card" content="${escHtml(seo.twitterCard)}" />
  <meta name="twitter:title" content="${escHtml(seo.ogTitle)}" />
  <meta name="twitter:description" content="${escHtml(seo.ogDescription)}" />
  ${seo.ogImageUrl ? `<meta name="twitter:image" content="${escHtml(seo.ogImageUrl)}" />` : ''}
  <script type="application/ld+json">${JSON.stringify(seo.jsonLd).replace(/</g, '\\u003c')}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Noto+Sans:ital,wght@0,400;0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>${SHARED_SSR_STYLES}</style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <a href="/p/${escHtml(locale)}" class="brand-mark">${escHtml(workspace.brandName)}</a>
      <nav class="lang-switcher" aria-label="${escHtml(dict.publicReader.switchLanguage)}">
        ${languageLinksHtml}
      </nav>
      <a href="/p/${escHtml(locale)}" class="action-btn" style="white-space:nowrap;">${escHtml(dict.publicReader.allArticles)}</a>
    </div>
  </header>

  <main class="container-reading">
    <article class="clay-card" style="padding:clamp(22px, 4vw, 44px);">
      <div class="meta-line">
        ${category ? `<span>${escHtml(category.names[locale] || category.names.fr)}</span><span aria-hidden="true">·</span>` : ''}
        <span>${escHtml(bundle.post.authorName)}</span>
        <span aria-hidden="true">·</span>
        <time datetime="${escHtml(bundle.post.publishedAt || bundle.post.createdAt)}">${escHtml(formatDate(bundle.post.publishedAt || bundle.post.createdAt, locale))}</time>
        <span aria-hidden="true">·</span>
        <span class="tabular">${translation.readingTimeMinutes} ${escHtml(dict.publicReader.readingTime)}</span>
      </div>

      <h1 class="article-title">${escHtml(translation.title)}</h1>

      ${
        bundle.post.featuredImageUrl && isSafeAssetOrHttpUrl(bundle.post.featuredImageUrl)
          ? `<figure class="cover-frame"><img src="${escHtml(bundle.post.featuredImageUrl)}" alt="${escHtml(translation.title)}" referrerpolicy="no-referrer" /></figure>`
          : ''
      }

      <div class="editorial-prose">
        ${translation.sanitizedHtml}
      </div>

      <hr style="border:0;border-top:1px solid var(--ailea-border);margin:36px 0 28px;" />

      <section aria-label="${escHtml(dict.reactions.title)}">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:8px;">
          <h2 style="font-size:1.15rem;font-weight:700;margin:0;">${escHtml(dict.reactions.publicPrompt)}</h2>
          <span style="font-size:0.82rem;color:var(--ailea-muted);">${escHtml(bundle.post.allowReactionChange ? dict.reactions.changeAllowed : dict.reactions.changeLocked)}</span>
        </div>

        <div class="reaction-grid" id="ailea-reactions" data-post-id="${escHtml(bundle.post.id)}" data-locale="${escHtml(locale)}">
          ${reactionFormsHtml}
        </div>
        <p id="ailea-reaction-feedback" role="status" style="font-size:0.85rem;color:var(--ailea-emerald);margin:12px 0 0;min-height:20px;"></p>
      </section>

      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:28px;padding-top:20px;border-top:1px solid var(--ailea-border);">
        <button type="button" class="action-btn" id="ailea-copy-link" data-url="${escHtml(seo.canonicalUrl)}">${escHtml(dict.common.copyLink)}</button>
        <button type="button" class="action-btn" id="ailea-share-btn" data-title="${escHtml(translation.title)}" data-url="${escHtml(seo.canonicalUrl)}">${escHtml(dict.common.share)}</button>
        <a href="/" class="action-btn" style="margin-left:auto;">Studio AILEA</a>
      </div>
    </article>

    ${relatedHtml}
  </main>

  <footer style="max-width:780px;margin:0 auto;padding:0 16px 40px;font-size:0.82rem;color:var(--ailea-muted);display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;">
    <span>${escHtml(workspace.brandName)} · AILEA PostManager</span>
    <a href="/sitemap.xml" style="color:var(--ailea-muted);">sitemap.xml</a>
  </footer>

  <script>
    (function () {
      var copyBtn = document.getElementById('ailea-copy-link');
      if (copyBtn) {
        copyBtn.addEventListener('click', function () {
          var url = copyBtn.getAttribute('data-url') || window.location.href;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(function () {
              copyBtn.textContent = ${JSON.stringify(dict.common.copied)};
              setTimeout(function () { copyBtn.textContent = ${JSON.stringify(dict.common.copyLink)}; }, 2000);
            });
          }
        });
      }

      var shareBtn = document.getElementById('ailea-share-btn');
      if (shareBtn) {
        shareBtn.addEventListener('click', function () {
          var title = shareBtn.getAttribute('data-title') || document.title;
          var url = shareBtn.getAttribute('data-url') || window.location.href;
          if (navigator.share) {
            navigator.share({ title: title, url: url }).catch(function () {});
          } else if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url);
            shareBtn.textContent = ${JSON.stringify(dict.common.copied)};
          }
        });
      }

      var container = document.getElementById('ailea-reactions');
      var feedback = document.getElementById('ailea-reaction-feedback');
      if (container && window.fetch) {
        var forms = container.querySelectorAll('.reaction-form');
        forms.forEach(function (form) {
          form.addEventListener('submit', function (e) {
            e.preventDefault();
            var postId = container.getAttribute('data-post-id');
            var locale = container.getAttribute('data-locale');
            var semanticKey = form.getAttribute('data-reaction-key');
            var idempotencyKey = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + '_' + Math.floor(Math.random() * 1e9);
            fetch('/api/public/reactions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ postId: postId, locale: locale, semanticKey: semanticKey, idempotencyKey: idempotencyKey })
            })
            .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (res) {
              if (!res.ok && res.data && res.data.error) {
                if (feedback) feedback.textContent = res.data.error;
                return;
              }
              if (res.data && Array.isArray(res.data.reactions)) {
                var active = res.data.activeKeys || [];
                container.querySelectorAll('.reaction-btn').forEach(function (btn) {
                  var key = btn.getAttribute('data-key');
                  btn.setAttribute('aria-pressed', active.indexOf(key) !== -1 ? 'true' : 'false');
                  var match = res.data.reactions.find(function (item) { return item.semanticKey === key; });
                  var countEl = btn.querySelector('.reaction-count');
                  if (match && countEl) countEl.textContent = String(match.count);
                });
                if (feedback) feedback.textContent = res.data.message || '';
              }
            })
            .catch(function () {
              form.submit();
            });
          });
        });
      }
    })();
  </script>
</body>
</html>`;
}

export function renderPublicIndexHtml(params: {
  baseUrl: string;
  locale: Locale;
  items: Array<{
    post: Post;
    translation: PostTranslation;
    workspace: Workspace;
    reactions: PostReaction[];
  }>;
}): string {
  const { baseUrl, locale, items } = params;
  const dict = UI_STRINGS[locale];
  const brandName = items[0]?.workspace.brandName || 'AILEA Revue';
  const canonicalUrl = buildAbsoluteUrl(baseUrl, `/p/${locale}`);

  const cardsHtml =
    items.length === 0
      ? `<div class="clay-card" style="padding:36px;text-align:center;color:var(--ailea-muted);">${escHtml(dict.publicReader.noArticles)}</div>`
      : items
          .map((item) => {
            const href = buildPublicPostPath(locale, item.translation.slug);
            const totalReactions = item.reactions.reduce((acc, r) => acc + (r.count || 0), 0);
            return `
            <article class="clay-card" style="overflow:hidden;display:flex;flex-direction:column;">
              ${
                item.post.featuredImageUrl && isSafeAssetOrHttpUrl(item.post.featuredImageUrl)
                  ? `<a href="${escHtml(href)}" style="display:block;aspect-ratio:16/9;background:#E4EAE6;overflow:hidden;"><img src="${escHtml(item.post.featuredImageUrl)}" alt="${escHtml(item.translation.title)}" style="width:100%;height:100%;object-fit:cover;display:block;" referrerpolicy="no-referrer" /></a>`
                  : ''
              }
              <div style="padding:24px;display:flex;flex-direction:column;gap:12px;flex:1;">
                <div style="font-size:0.82rem;color:var(--ailea-muted);display:flex;gap:8px;flex-wrap:wrap;">
                  <span>${escHtml(item.post.authorName)}</span>
                  <span aria-hidden="true">·</span>
                  <span>${escHtml(formatDate(item.post.publishedAt || item.post.createdAt, locale))}</span>
                  <span aria-hidden="true">·</span>
                  <span class="tabular">${item.translation.readingTimeMinutes} ${escHtml(dict.publicReader.readingTime)}</span>
                </div>
                <h2 style="font-family:'Lora','Noto Sans',serif;font-size:1.35rem;line-height:1.3;margin:0;">
                  <a href="${escHtml(href)}" style="color:var(--ailea-ink);text-decoration:none;">${escHtml(item.translation.title)}</a>
                </h2>
                <p style="margin:0;color:var(--ailea-muted);font-size:0.95rem;line-height:1.6;">${escHtml(item.translation.excerpt)}</p>
                <div style="margin-top:auto;padding-top:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
                  <a href="${escHtml(href)}" class="action-btn action-btn-primary" style="min-height:48px;">${escHtml(dict.publicReader.readArticle)}</a>
                  <span class="tabular" style="font-size:0.85rem;color:var(--ailea-muted);">${totalReactions} ${escHtml(dict.nav.reactions.toLowerCase())}</span>
                </div>
              </div>
            </article>`;
          })
          .join('\n');

  const hreflangsHtml = (['fr', 'en'] as const)
    .map(
      (loc) =>
        `  <link rel="alternate" hreflang="${loc}" href="${escHtml(buildAbsoluteUrl(baseUrl, `/p/${loc}`))}" />`
    )
    .join('\n');

  return `<!doctype html>
<html lang="${escHtml(locale)}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(brandName)} — ${escHtml(dict.publicReader.allArticles)}</title>
  <meta name="description" content="${escHtml(dict.brandTagline)}" />
  <link rel="canonical" href="${escHtml(canonicalUrl)}" />
${locale !== 'fon' ? hreflangsHtml : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Noto+Sans:ital,wght@0,400;0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>${SHARED_SSR_STYLES}</style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <a href="/p/${escHtml(locale)}" class="brand-mark">${escHtml(brandName)}</a>
      <nav class="lang-switcher" aria-label="${escHtml(dict.publicReader.switchLanguage)}">
        ${SUPPORTED_LOCALES.map(
          (loc) =>
            `<a href="/p/${loc}" class="lang-link" ${loc === locale ? 'aria-current="page"' : ''}>${escHtml(LOCALE_META[loc].nativeName)}</a>`
        ).join('')}
      </nav>
      <a href="/" class="action-btn">Studio AILEA</a>
    </div>
  </header>

  <main style="max-width:1020px;margin:0 auto;padding:36px 16px 72px;">
    <h1 style="font-family:'Lora','Noto Sans',serif;font-size:clamp(1.85rem,3.6vw,2.6rem);margin:0 0 28px;">${escHtml(dict.publicReader.allArticles)}</h1>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px;">
      ${cardsHtml}
    </div>
  </main>
</body>
</html>`;
}

export function renderNotFoundHtml(locale: Locale, baseUrl: string): string {
  const title = locale === 'en' ? 'Article not found' : locale === 'fon' ? 'Xówlǎn élɔ́ ɖò fí ǎ' : 'Article introuvable';
  const back = locale === 'en' ? 'Back to publications' : locale === 'fon' ? 'Lɛ́ kɔ wá tò-bǐ tɛ́n' : 'Retour aux publications';
  return `<!doctype html>
<html lang="${escHtml(locale)}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${escHtml(title)} — AILEA</title>
  <style>${SHARED_SSR_STYLES}</style>
</head>
<body>
  <main class="container-reading">
    <div class="clay-card" style="padding:40px;text-align:center;">
      <h1 style="margin:0 0 12px;font-size:1.6rem;">${escHtml(title)}</h1>
      <p style="color:var(--ailea-muted);margin:0 0 24px;">${escHtml(baseUrl)}</p>
      <a href="/p/${escHtml(locale)}" class="action-btn action-btn-primary">${escHtml(back)}</a>
    </div>
  </main>
</body>
</html>`;
}
