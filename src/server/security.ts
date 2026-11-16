import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { isEmulatorModeRequested } from './emulatorGuard.ts';
import type { DataRepository } from './repository.ts';

const EPHEMERAL_FALLBACK_SALT = crypto.randomBytes(32).toString('hex');
let warnedMissingHmacSecret = false;

export function getHmacSecret(): string {
  const configured = process.env.REACTION_HMAC_SECRET;
  if (configured && configured !== 'CHANGE_ME_IN_PRODUCTION' && configured.length >= 16) {
    return configured;
  }
  if (process.env.NODE_ENV === 'production' && !isEmulatorModeRequested()) {
    if (process.env.VITEST === 'true') {
      throw new Error(
        'SECURITY_CONFIG_ERROR: REACTION_HMAC_SECRET (min 16 chars) is required in production.'
      );
    }
    if (!warnedMissingHmacSecret) {
      warnedMissingHmacSecret = true;
      console.warn(
        'SECURITY_CONFIG_WARNING: REACTION_HMAC_SECRET is not configured; using ephemeral fallback salt.'
      );
    }
  }
  return EPHEMERAL_FALLBACK_SALT;
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    try {
      const key = decodeURIComponent(part.slice(0, eqIdx).trim());
      const val = decodeURIComponent(part.slice(eqIdx + 1).trim());
      result[key] = val;
    } catch {
      // Ignore malformed percent-encoding in cookies
    }
  }
  return result;
}

const VISITOR_TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days

function signVisitorPayload(nonceHex: string, issuedAtSec: number): string {
  return crypto
    .createHmac('sha256', getHmacSecret())
    .update(`vid:${nonceHex}.${issuedAtSec}`)
    .digest('hex')
    .slice(0, 32);
}

export function issueSignedVisitorToken(nowMs = Date.now()): string {
  const nonceHex = crypto.randomBytes(16).toString('hex');
  const issuedAtSec = Math.floor(nowMs / 1000);
  const sig = signVisitorPayload(nonceHex, issuedAtSec);
  return `${nonceHex}.${issuedAtSec}.${sig}`;
}

export function verifySignedVisitorToken(token: string | undefined, nowMs = Date.now()): string | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;
  const [nonceHex, issuedAtRaw, providedSig] = parts;
  if (!/^[a-f0-9]{32}$/.test(nonceHex) || !/^\d{9,12}$/.test(issuedAtRaw) || !/^[a-f0-9]{32}$/.test(providedSig)) {
    return null;
  }
  const issuedAtSec = Number(issuedAtRaw);
  const nowSec = Math.floor(nowMs / 1000);
  if (!Number.isFinite(issuedAtSec) || issuedAtSec > nowSec + 60 || nowSec - issuedAtSec > VISITOR_TOKEN_TTL_SECONDS) {
    return null;
  }
  const expectedSig = signVisitorPayload(nonceHex, issuedAtSec);
  const a = Buffer.from(providedSig, 'hex');
  const b = Buffer.from(expectedSig, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  return nonceHex;
}

function hashVisitorId(workspaceId: string, verifiedNonce: string): string {
  return crypto
    .createHmac('sha256', getHmacSecret())
    .update(`${workspaceId}:${verifiedNonce}`)
    .digest('hex')
    .slice(0, 32);
}

export function getOrIssueVisitorToken(req: Request, res: Response): string {
  const cookies = parseCookies(req.headers.cookie);
  const existingNonce = verifySignedVisitorToken(cookies['ailea_vid']);
  if (existingNonce) {
    return existingNonce;
  }
  const signedToken = issueSignedVisitorToken();
  res.cookie('ailea_vid', signedToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: VISITOR_TOKEN_TTL_SECONDS * 1000,
    path: '/',
  });
  return signedToken.split('.')[0];
}

export function computeVisitorHash(req: Request, res: Response, workspaceId: string): string {
  const vid = getOrIssueVisitorToken(req, res);
  return hashVisitorId(workspaceId, vid);
}

/**
 * Resolves a pre-issued HMAC-signed visitor identity WITHOUT minting a fresh token.
 * Prevents attackers from bypassing per-visitor reaction limits by omitting cookies.
 */
export function resolveExistingVisitorHash(req: Request, workspaceId: string): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const verifiedNonce = verifySignedVisitorToken(cookies['ailea_vid']);
  if (!verifiedNonce) return null;
  return hashVisitorId(workspaceId, verifiedNonce);
}

/**
 * Resolves a visitor hash for view logging: uses verified cookie if present,
 * otherwise derives a deterministic daily IP-scoped anonymous hash without issuing a fresh vote cookie.
 */
export function resolveViewVisitorHash(req: Request, workspaceId: string): string {
  const existing = resolveExistingVisitorHash(req, workspaceId);
  if (existing) return existing;
  const ipKey = computeIpBucketKey(req);
  const ua = String(req.headers['user-agent'] || '').slice(0, 120);
  return crypto
    .createHmac('sha256', getHmacSecret())
    .update(`view:${workspaceId}:${ipKey}:${ua}`)
    .digest('hex')
    .slice(0, 32);
}

export function computeIpBucketKey(req: Request): string {
  // Relies on Express `trust proxy: 1` (`req.ip`) rather than spoofable leftmost X-Forwarded-For
  const rawIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
  return crypto
    .createHmac('sha256', getHmacSecret())
    .update(`ip:${rawIp}`)
    .digest('hex')
    .slice(0, 24);
}

export class SlidingWindowRateLimiter {
  private readonly windows = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly maxEntries = 20000
  ) {}

  private pruneExpired(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [k, list] of this.windows.entries()) {
      const active = list.filter((ts) => ts > cutoff);
      if (active.length === 0) {
        this.windows.delete(k);
      } else if (active.length !== list.length) {
        this.windows.set(k, active);
      }
    }
  }

  private evictOneNonThrottledOrOldest(): void {
    // Prefer evicting an unthrottled entry so high-cardinality floods cannot evict actively blocked IPs
    for (const [k, list] of this.windows.entries()) {
      if (list.length < this.maxRequests) {
        this.windows.delete(k);
        return;
      }
    }
    const oldestKey = this.windows.keys().next().value;
    if (oldestKey) this.windows.delete(oldestKey);
  }

  consume(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = (this.windows.get(key) || []).filter((ts) => ts > cutoff);

    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0] || now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      // Refresh LRU order so active throttled keys are not evicted before idle entries
      this.windows.delete(key);
      this.windows.set(key, timestamps);
      return { allowed: false, retryAfterSeconds };
    }

    if (this.windows.size >= this.maxEntries) {
      this.pruneExpired(now);
      if (this.windows.size >= this.maxEntries) {
        this.evictOneNonThrottledOrOldest();
      }
    }

    timestamps.push(now);
    this.windows.delete(key);
    this.windows.set(key, timestamps);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export const publicReactionLimiter = new SlidingWindowRateLimiter(30, 60_000);
export const publicViewLimiter = new SlidingWindowRateLimiter(120, 60_000);
export const adminMutationLimiter = new SlidingWindowRateLimiter(120, 60_000);

/**
 * Distributed Firestore-backed rate-limit bucket (`rateLimitBuckets`) for multi-instance enforcement.
 */
export async function consumeDistributedRateLimit(
  repo: DataRepository,
  bucketKey: string,
  maxRequests: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const safeId = bucketKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160);
  const path = `rateLimitBuckets/${safeId}`;
  const nowMs = Date.now();

  return repo.runTransaction(async (tx) => {
    const existing = await tx.get<{ key: string; count: number; windowStartMs: number; expiresAt: string }>(path);
    if (!existing || nowMs - existing.windowStartMs >= windowMs) {
      tx.set(path, {
        key: safeId,
        count: 1,
        windowStartMs: nowMs,
        expiresAt: new Date(nowMs + windowMs).toISOString(),
      });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (existing.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.windowStartMs + windowMs - nowMs) / 1000));
      return { allowed: false, retryAfterSeconds };
    }

    tx.update(path, { count: existing.count + 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  });
}

export function sanitizeReferrerHost(referrerHeader: string | undefined, appBaseUrl: string): string {
  if (!referrerHeader) return 'Direct';
  try {
    const refUrl = new URL(referrerHeader);
    const appHost = new URL(appBaseUrl).hostname;
    if (refUrl.hostname === appHost) return 'Internal';
    return refUrl.hostname.slice(0, 100);
  } catch {
    return 'Direct';
  }
}

export function validateImageBuffer(mimeType: string, buffer: Buffer): { ok: boolean; error?: string } {
  const allowedMimes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  if (!allowedMimes.has(mimeType)) {
    return { ok: false, error: 'Format non autorisé. Utilisez PNG, JPEG, WebP ou GIF.' };
  }
  if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
    return { ok: false, error: 'Taille de fichier invalide (max 5 Mo).' };
  }
  // Magic bytes verification
  const isPng = buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isJpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isGif = buffer.subarray(0, 3).toString('ascii') === 'GIF';
  const isWebp =
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  if (
    (mimeType === 'image/png' && !isPng) ||
    (mimeType === 'image/jpeg' && !isJpg) ||
    (mimeType === 'image/gif' && !isGif) ||
    (mimeType === 'image/webp' && !isWebp)
  ) {
    return { ok: false, error: 'Signature binaire invalide pour le type MIME déclaré.' };
  }
  return { ok: true };
}
