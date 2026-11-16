import React, { useEffect, useState } from 'react';
import { auth } from '../lib/firebase.ts';
import { getActiveWorkspaceId } from '../lib/api.ts';

interface AuthorizedMediaImageProps {
  src: string;
  alt: string;
  className?: string;
}

export function AuthorizedMediaImage({ src, alt, className }: AuthorizedMediaImageProps) {
  const isProtectedMediaApi = src.startsWith('/api/media/');
  const [resolvedSrc, setResolvedSrc] = useState<string>(isProtectedMediaApi ? '' : src);

  useEffect(() => {
    if (!isProtectedMediaApi) {
      setResolvedSrc(src);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    const loadAuthorizedMedia = async () => {
      try {
        const headers: Record<string, string> = {};
        const wsId = getActiveWorkspaceId();
        if (wsId) headers['X-Workspace-Id'] = wsId;
        const user = auth.currentUser;
        if (user) {
          headers['Authorization'] = `Bearer ${await user.getIdToken()}`;
        }
        const res = await fetch(src, { headers });
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setResolvedSrc(objectUrl);
      } catch {
        // Leave preview empty on network/auth failure
      }
    };

    loadAuthorizedMedia();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src, isProtectedMediaApi]);

  if (!resolvedSrc) {
    return <div className={`bg-[#E5F3EA] ${className || ''}`} aria-label={alt} />;
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      className={className}
    />
  );
}
