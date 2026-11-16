import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
import {
  Locale,
  Post,
  PostReaction,
  PostTranslation,
  SEOSetting,
  SUPPORTED_LOCALES,
  ValidationIssue,
  ValidationReport,
} from './types.ts';

marked.setOptions({
  gfm: true,
  breaks: true,
});

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
  errors: string[];
}

export function parseMarkdownWithFrontmatter(raw: string): ParsedMarkdown {
  const errors: string[] = [];
  const normalized = raw.replace(/\r\n/g, '\n');

  if (normalized.startsWith('---\n')) {
    const endIdx = normalized.indexOf('\n---\n', 4);
    const endAtEof = normalized.endsWith('\n---') ? normalized.length - 4 : -1;
    const closeIdx = endIdx !== -1 ? endIdx : endAtEof;

    if (closeIdx !== -1) {
      const yamlBlock = normalized.slice(4, closeIdx);
      const body = normalized.slice(closeIdx + (endIdx !== -1 ? 5 : 4)).trimStart();
      try {
        const parsed = yamlLoad(yamlBlock);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return {
            frontmatter: parsed as Record<string, unknown>,
            body,
            errors,
          };
        }
        return { frontmatter: {}, body, errors: ['Frontmatter YAML must be a key-value mapping.'] };
      } catch (err) {
        errors.push(err instanceof Error ? `Invalid YAML frontmatter: ${err.message}` : 'Invalid YAML frontmatter');
        return { frontmatter: {}, body, errors };
      }
    }
  }

  return { frontmatter: {}, body: normalized, errors };
}

export function serializeMarkdownWithFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string
): string {
  const cleanFm = Object.fromEntries(
    Object.entries(frontmatter).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
  if (Object.keys(cleanFm).length === 0) {
    return body;
  }
  const yamlString = yamlDump(cleanFm, { lineWidth: 100, noRefs: true }).trim();
  return `---\n${yamlString}\n---\n\n${body}`;
}

let domPurifyHookRegistered = false;
function ensureDomPurifyHooks() {
  if (domPurifyHookRegistered) return;
  domPurifyHookRegistered = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const tagName = node.tagName ? node.tagName.toLowerCase() : '';
    if (tagName === 'a') {
      const href = node.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      } else {
        node.removeAttribute('target');
      }
    } else if (tagName === 'img') {
      const src = node.getAttribute('src') || '';
      if (!/^(\/(?!\/)|https?:\/\/)/i.test(src)) {
        node.removeAttribute('src');
      }
      node.setAttribute('loading', 'lazy');
      node.setAttribute('referrerpolicy', 'no-referrer');
    }
  });
}

export function sanitizeAndRenderMarkdown(markdown: string): string {
  ensureDomPurifyHooks();
  const rawHtml = marked.parse(markdown || '', { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr', 'blockquote', 'pre', 'code',
      'ul', 'ol', 'li', 'input',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'strong', 'em', 'del', 's', 'a', 'img', 'span', 'div',
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'target', 'rel',
      'src', 'alt', 'width', 'height', 'loading', 'referrerpolicy',
      'type', 'checked', 'disabled', 'class', 'id',
    ],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'svg', 'math'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
    ALLOW_DATA_ATTR: false,
  });
}

export function generateSlug(input: string): string {
  if (!input) return '';
  const mapped = input
    .replace(/[ɛƐ]/g, 'e')
    .replace(/[ɔƆ]/g, 'o')
    .replace(/[ɖƉ]/g, 'd')
    .replace(/[ŋŊ]/g, 'ng')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return mapped.slice(0, 140);
}

export function computeWordCountAndReadingTime(markdown: string): { wordCount: number; readingTimeMinutes: number } {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/[#>*_~\-\[\]()!|]/g, ' ')
    .trim();
  if (!plain) return { wordCount: 0, readingTimeMinutes: 1 };
  const words = plain.split(/\s+/).filter(Boolean).length;
  const readingTimeMinutes = Math.max(1, Math.ceil(words / 200));
  return { wordCount: words, readingTimeMinutes };
}

export function extractExcerpt(markdown: string, maxLength = 160): string {
  const lines = markdown
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('![') && !l.startsWith('---') && !l.startsWith('|'));
  const first = (lines[0] || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim();
  if (first.length <= maxLength) return first;
  return `${first.slice(0, maxLength - 1).trim()}…`;
}

export function validatePostForPublication(params: {
  post: Post;
  translations: Record<Locale, PostTranslation | null>;
  reactions: PostReaction[];
  seo: Record<Locale, SEOSetting | null>;
}): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const { post, translations, reactions, seo } = params;

  const primaryTranslation = translations[post.primaryLocale];
  if (!primaryTranslation || !primaryTranslation.title.trim()) {
    errors.push({
      code: 'PRIMARY_TITLE_MISSING',
      severity: 'error',
      locale: post.primaryLocale,
      field: 'title',
      message: `Le titre dans la langue principale (${post.primaryLocale.toUpperCase()}) est requis.`,
    });
  }

  if (!primaryTranslation || !primaryTranslation.slug.trim() || !/^[a-z0-9-]+$/.test(primaryTranslation.slug)) {
    errors.push({
      code: 'PRIMARY_SLUG_INVALID',
      severity: 'error',
      locale: post.primaryLocale,
      field: 'slug',
      message: `Le slug permanent (${post.primaryLocale.toUpperCase()}) doit contenir uniquement des lettres minuscules, chiffres et tirets.`,
    });
  }

  if (!primaryTranslation || primaryTranslation.markdownContent.trim().length < 20) {
    errors.push({
      code: 'PRIMARY_CONTENT_TOO_SHORT',
      severity: 'error',
      locale: post.primaryLocale,
      field: 'markdownContent',
      message: `Le contenu Markdown (${post.primaryLocale.toUpperCase()}) doit contenir au moins 20 caractères.`,
    });
  }

  // Validate each populated translation
  for (const loc of SUPPORTED_LOCALES) {
    const tr = translations[loc];
    if (!tr) continue;
    const hasContent = tr.title.trim().length > 0 || tr.markdownContent.trim().length > 0;
    if (!hasContent) continue;

    if (!tr.title.trim()) {
      errors.push({
        code: 'TRANSLATION_TITLE_MISSING',
        severity: 'error',
        locale: loc,
        field: 'title',
        message: `La version ${loc.toUpperCase()} possède du contenu mais aucun titre.`,
      });
    }
    if (!tr.slug.trim() || !/^[a-z0-9-]+$/.test(tr.slug)) {
      errors.push({
        code: 'TRANSLATION_SLUG_INVALID',
        severity: 'error',
        locale: loc,
        field: 'slug',
        message: `Le slug pour la version ${loc.toUpperCase()} est manquant ou invalide.`,
      });
    }
    if (loc === 'fon' && tr.translationStatus !== 'approved') {
      errors.push({
        code: 'FONGBE_APPROVAL_REQUIRED',
        severity: 'error',
        locale: 'fon',
        field: 'translationStatus',
        message:
          'La traduction Fɔngbè doit être révisée et approuvée par un relecteur humain avant publication.',
      });
    }

    const seoRow = seo[loc];
    if (!seoRow || !seoRow.metaTitle.trim()) {
      warnings.push({
        code: 'SEO_META_TITLE_DEFAULTED',
        severity: 'warning',
        locale: loc,
        field: 'metaTitle',
        message: `Titre SEO spécifique absent pour ${loc.toUpperCase()} — le titre de l’article sera utilisé.`,
      });
    }
    if (!seoRow || !seoRow.metaDescription.trim()) {
      warnings.push({
        code: 'SEO_META_DESC_DEFAULTED',
        severity: 'warning',
        locale: loc,
        field: 'metaDescription',
        message: `Méta-description absente pour ${loc.toUpperCase()} — un extrait sera utilisé.`,
      });
    }
  }

  // Validate semantic reactions
  const enabledReactions = reactions.filter((r) => r.enabled);
  if (enabledReactions.length === 0) {
    errors.push({
      code: 'NO_ENABLED_REACTIONS',
      severity: 'error',
      field: 'reactions',
      message: 'Au moins une réaction sémantique activée est requise pour publier.',
    });
  }

  const seenKeys = new Set<string>();
  for (const reaction of enabledReactions) {
    if (!/^[a-z0-9_-]+$/.test(reaction.semanticKey)) {
      errors.push({
        code: 'INVALID_REACTION_KEY',
        severity: 'error',
        field: 'reactions',
        message: `Clé sémantique invalide : "${reaction.semanticKey}".`,
      });
    }
    if (seenKeys.has(reaction.semanticKey)) {
      errors.push({
        code: 'DUPLICATE_REACTION_KEY',
        severity: 'error',
        field: 'reactions',
        message: `Clé sémantique dupliquée : "${reaction.semanticKey}".`,
      });
    }
    seenKeys.add(reaction.semanticKey);

    if (!reaction.labels.fr.trim() || !reaction.labels.en.trim() || !reaction.labels.fon.trim()) {
      errors.push({
        code: 'REACTION_LABELS_INCOMPLETE',
        severity: 'error',
        field: 'reactions',
        message: `La réaction "${reaction.semanticKey}" doit avoir un libellé en français, anglais et fɔngbè.`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
