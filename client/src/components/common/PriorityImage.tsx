import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ImgHTMLAttributes,
} from 'react';

type LoadStatus = 'idle' | 'queued' | 'loading' | 'loaded' | 'error';
type LoadPriority = 'warm' | 'visible' | 'interactive';
type QueueBucket = 'high' | 'warm';

interface ImageRecord {
  status: LoadStatus;
  priority: LoadPriority;
  requestId: number;
  listeners: Set<() => void>;
}

interface ScopeRecord {
  pendingCount: number;
  listeners: Set<() => void>;
}

interface RevealSessionRecord {
  pendingCount: number;
  trackedCount: number;
  measuredCount: number;
  listeners: Set<() => void>;
}

interface PriorityImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'loading'> {
  src: string;
  expansionPriorityToken?: number;
  hideOnError?: boolean;
  loadScope?: string;
  revealSession?: string;
}

const PLACEHOLDER_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const HIGH_PRIORITY_CONCURRENCY = 6;
const WARM_PRIORITY_CONCURRENCY = 2;
const IMAGE_LOAD_TIMEOUT_MS = 15000;

const imageRecords = new Map<string, ImageRecord>();
const scopeRecords = new Map<string, ScopeRecord>();
const revealSessionRecords = new Map<string, RevealSessionRecord>();

let nextRequestId = 1;
let activeHighPriorityLoads = 0;
let activeWarmPriorityLoads = 0;

function priorityRank(priority: LoadPriority): number {
  switch (priority) {
    case 'interactive':
      return 3;
    case 'visible':
      return 2;
    case 'warm':
    default:
      return 1;
  }
}

function getOrCreateRecord(src: string): ImageRecord {
  const existing = imageRecords.get(src);
  if (existing) {
    return existing;
  }

  const created: ImageRecord = {
    status: 'idle',
    priority: 'warm',
    requestId: 0,
    listeners: new Set(),
  };
  imageRecords.set(src, created);
  return created;
}

function getImageStatus(src: string): LoadStatus {
  return getOrCreateRecord(src).status;
}

function notifyImageListeners(src: string) {
  const record = imageRecords.get(src);
  if (!record) return;
  record.listeners.forEach((listener) => listener());
}

function getOrCreateScopeRecord(scope: string): ScopeRecord {
  const existing = scopeRecords.get(scope);
  if (existing) {
    return existing;
  }

  const created: ScopeRecord = {
    pendingCount: 0,
    listeners: new Set(),
  };
  scopeRecords.set(scope, created);
  return created;
}

function getScopePendingCount(scope: string): number {
  return getOrCreateScopeRecord(scope).pendingCount;
}

function notifyScopeListeners(scope: string) {
  const record = scopeRecords.get(scope);
  if (!record) return;
  record.listeners.forEach((listener) => listener());
}

function adjustScopePendingCount(scope: string, delta: number) {
  const record = getOrCreateScopeRecord(scope);
  record.pendingCount = Math.max(0, record.pendingCount + delta);
  notifyScopeListeners(scope);
}

function subscribeToScope(scope: string, listener: () => void): () => void {
  const record = getOrCreateScopeRecord(scope);
  record.listeners.add(listener);
  return () => {
    record.listeners.delete(listener);
  };
}

function subscribeToImage(src: string, listener: () => void): () => void {
  const record = getOrCreateRecord(src);
  record.listeners.add(listener);
  return () => {
    record.listeners.delete(listener);
  };
}

function getOrCreateRevealSessionRecord(session: string): RevealSessionRecord {
  const existing = revealSessionRecords.get(session);
  if (existing) {
    return existing;
  }

  const created: RevealSessionRecord = {
    pendingCount: 0,
    trackedCount: 0,
    measuredCount: 0,
    listeners: new Set(),
  };
  revealSessionRecords.set(session, created);
  return created;
}

function notifyRevealSessionListeners(session: string) {
  const record = revealSessionRecords.get(session);
  if (!record) return;
  record.listeners.forEach((listener) => listener());
}

function adjustRevealSessionCounts(
  session: string,
  counts: Partial<Pick<RevealSessionRecord, 'pendingCount' | 'trackedCount' | 'measuredCount'>>,
) {
  const record = getOrCreateRevealSessionRecord(session);
  record.pendingCount = Math.max(0, record.pendingCount + (counts.pendingCount ?? 0));
  record.trackedCount = Math.max(0, record.trackedCount + (counts.trackedCount ?? 0));
  record.measuredCount = Math.max(0, record.measuredCount + (counts.measuredCount ?? 0));
  notifyRevealSessionListeners(session);
}

function getRevealSessionSnapshot(session: string) {
  const record = revealSessionRecords.get(session);
  if (!record) {
    return null;
  }

  return {
    pendingCount: record.pendingCount,
    trackedCount: record.trackedCount,
    measuredCount: record.measuredCount,
  };
}

function subscribeToRevealSession(session: string, listener: () => void): () => void {
  const record = getOrCreateRevealSessionRecord(session);
  record.listeners.add(listener);
  return () => {
    record.listeners.delete(listener);
  };
}

function hasQueuedHighPriorityImages(): boolean {
  for (const record of imageRecords.values()) {
    if (record.status === 'queued' && priorityRank(record.priority) >= priorityRank('visible')) {
      return true;
    }
  }
  return false;
}

function pickNextQueuedImage(bucket: QueueBucket): [string, ImageRecord] | null {
  let best: [string, ImageRecord] | null = null;

  for (const entry of imageRecords.entries()) {
    const [src, record] = entry;
    if (record.status !== 'queued') continue;

    const isHighPriority = priorityRank(record.priority) >= priorityRank('visible');
    if ((bucket === 'high' && !isHighPriority) || (bucket === 'warm' && isHighPriority)) {
      continue;
    }

    if (!best) {
      best = [src, record];
      continue;
    }

    const [, bestRecord] = best;
    const rankDiff = priorityRank(record.priority) - priorityRank(bestRecord.priority);
    if (rankDiff > 0 || (rankDiff === 0 && record.requestId > bestRecord.requestId)) {
      best = [src, record];
    }
  }

  return best;
}

function pumpImageQueue() {
  while (activeHighPriorityLoads < HIGH_PRIORITY_CONCURRENCY) {
    const next = pickNextQueuedImage('high');
    if (!next) break;
    startImageLoad(next[0], next[1], 'high');
  }

  while (
    activeWarmPriorityLoads < WARM_PRIORITY_CONCURRENCY
    && activeHighPriorityLoads === 0
    && !hasQueuedHighPriorityImages()
  ) {
    const next = pickNextQueuedImage('warm');
    if (!next) break;
    startImageLoad(next[0], next[1], 'warm');
  }
}

function startImageLoad(src: string, record: ImageRecord, bucket: QueueBucket) {
  record.status = 'loading';
  notifyImageListeners(src);

  if (bucket === 'high') {
    activeHighPriorityLoads += 1;
  } else {
    activeWarmPriorityLoads += 1;
  }

  const img = new Image();
  img.decoding = 'async';
  let settled = false;

  const timeoutId = window.setTimeout(() => {
    finalize('error');
  }, IMAGE_LOAD_TIMEOUT_MS);

  const finalize = (status: Extract<LoadStatus, 'loaded' | 'error'>) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeoutId);
    record.status = status;
    notifyImageListeners(src);

    if (bucket === 'high') {
      activeHighPriorityLoads -= 1;
    } else {
      activeWarmPriorityLoads -= 1;
    }

    pumpImageQueue();
  };

  img.onload = () => finalize('loaded');
  img.onerror = () => finalize('error');
  img.src = src;
}

function requestImageLoad(src: string, priority: LoadPriority) {
  const record = getOrCreateRecord(src);
  if (record.status === 'loaded' || record.status === 'error') {
    return;
  }

  if (record.status === 'loading') {
    return;
  }

  if (record.status === 'queued') {
    const currentPriorityRank = priorityRank(record.priority);
    const requestedPriorityRank = priorityRank(priority);
    if (requestedPriorityRank > currentPriorityRank) {
      record.priority = priority;
      record.requestId = nextRequestId++;
      notifyImageListeners(src);
    }
    pumpImageQueue();
    return;
  }

  record.status = 'queued';
  record.priority = priority;
  record.requestId = nextRequestId++;
  notifyImageListeners(src);
  pumpImageQueue();
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePriorityImageScopePending(scope: string | null | undefined): boolean {
  const normalizedScope = scope ?? null;
  return useSyncExternalStore(
    (onStoreChange) => (normalizedScope ? subscribeToScope(normalizedScope, onStoreChange) : () => {}),
    () => (normalizedScope ? getScopePendingCount(normalizedScope) > 0 : false),
    () => false,
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePriorityImageRevealState(session: string | null | undefined) {
  const normalizedSession = session ?? null;
  return useSyncExternalStore(
    (onStoreChange) => (normalizedSession ? subscribeToRevealSession(normalizedSession, onStoreChange) : () => {}),
    () => {
      if (!normalizedSession) {
        return {
          pending: false,
          snapshotReady: true,
        };
      }

      const snapshot = getRevealSessionSnapshot(normalizedSession);
      if (!snapshot) {
        return {
          pending: false,
          snapshotReady: false,
        };
      }

      return {
        pending: snapshot.pendingCount > 0,
        snapshotReady: snapshot.trackedCount === snapshot.measuredCount,
      };
    },
    () => ({
      pending: false,
      snapshotReady: true,
    }),
  );
}

export default function PriorityImage({
  src,
  alt,
  className,
  width,
  height,
  decoding,
  expansionPriorityToken = 0,
  hideOnError = false,
  loadScope,
  revealSession,
  ...imgProps
}: PriorityImageProps) {
  const supportsIntersectionObserver = typeof IntersectionObserver !== 'undefined';
  const imgRef = useRef<HTMLImageElement>(null);
  const status = useSyncExternalStore(
    (onStoreChange) => subscribeToImage(src, onStoreChange),
    () => getImageStatus(src),
    () => getImageStatus(src),
  );
  const [isVisible, setIsVisible] = useState(!supportsIntersectionObserver);
  const [hasMeasuredVisibility, setHasMeasuredVisibility] = useState(!supportsIntersectionObserver);
  const lastExpansionTokenRef = useRef(expansionPriorityToken);
  const trackedScopeRef = useRef<string | null>(null);
  const trackedPendingRef = useRef(false);
  const initialViewportVisibilityRef = useRef<boolean | null>(null);
  const trackedRevealSessionRef = useRef<string | null>(null);
  const trackedRevealCandidateRef = useRef(false);
  const trackedRevealMeasuredSessionRef = useRef<string | null>(null);
  const trackedRevealMeasuredRef = useRef(false);
  const trackedRevealPendingSessionRef = useRef<string | null>(null);
  const trackedRevealPendingRef = useRef(false);

  useEffect(() => {
    const node = imgRef.current;
    if (!node) return undefined;

    if (!supportsIntersectionObserver) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const nextIsVisible = Boolean(entry?.isIntersecting);
        setIsVisible(nextIsVisible);
        if (initialViewportVisibilityRef.current === null) {
          initialViewportVisibilityRef.current = nextIsVisible;
        }
        setHasMeasuredVisibility(true);
      },
      {
        threshold: 0.01,
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [supportsIntersectionObserver]);

  useEffect(() => {
    if (initialViewportVisibilityRef.current === null && hasMeasuredVisibility) {
      initialViewportVisibilityRef.current = isVisible;
    }
  }, [hasMeasuredVisibility, isVisible]);

  useEffect(() => {
    if (!hasMeasuredVisibility) return;
    if (status === 'loaded' || status === 'error') return;
    requestImageLoad(src, isVisible ? 'visible' : 'warm');
  }, [hasMeasuredVisibility, isVisible, src, status]);

  useEffect(() => {
    if (status === 'loaded' || status === 'error') {
      lastExpansionTokenRef.current = expansionPriorityToken;
      return;
    }

    if (expansionPriorityToken > lastExpansionTokenRef.current) {
      requestImageLoad(src, 'interactive');
    }

    lastExpansionTokenRef.current = expansionPriorityToken;
  }, [expansionPriorityToken, src, status]);

  useEffect(() => {
    const nextScope = loadScope ?? null;
    const nextPending = Boolean(nextScope) && status !== 'loaded' && status !== 'error';

    if (trackedScopeRef.current && trackedPendingRef.current) {
      if (trackedScopeRef.current !== nextScope || !nextPending) {
        adjustScopePendingCount(trackedScopeRef.current, -1);
        trackedPendingRef.current = false;
      }
    }

    if (nextScope && nextPending) {
      if (trackedScopeRef.current !== nextScope || !trackedPendingRef.current) {
        adjustScopePendingCount(nextScope, 1);
        trackedPendingRef.current = true;
      }
    }

    trackedScopeRef.current = nextScope;

    return () => {
      if (trackedScopeRef.current && trackedPendingRef.current) {
        adjustScopePendingCount(trackedScopeRef.current, -1);
        trackedPendingRef.current = false;
      }
    };
  }, [loadScope, status]);

  useLayoutEffect(() => {
    const nextSession = revealSession ?? null;
    const shouldTrackCandidate = Boolean(nextSession);

    trackedRevealSessionRef.current = nextSession;
    trackedRevealCandidateRef.current = false;

    if (nextSession && shouldTrackCandidate) {
      adjustRevealSessionCounts(nextSession, { trackedCount: 1 });
      trackedRevealCandidateRef.current = true;
    }

    return () => {
      if (trackedRevealSessionRef.current && trackedRevealCandidateRef.current) {
        adjustRevealSessionCounts(trackedRevealSessionRef.current, { trackedCount: -1 });
        trackedRevealCandidateRef.current = false;
      }
    };
  }, [revealSession]);

  useEffect(() => {
    const nextSession = revealSession ?? null;
    const shouldTrackMeasured = Boolean(nextSession)
      && hasMeasuredVisibility;

    trackedRevealMeasuredSessionRef.current = nextSession;
    trackedRevealMeasuredRef.current = false;

    if (nextSession && shouldTrackMeasured) {
      adjustRevealSessionCounts(nextSession, { measuredCount: 1 });
      trackedRevealMeasuredRef.current = true;
    }

    return () => {
      if (trackedRevealMeasuredSessionRef.current && trackedRevealMeasuredRef.current) {
        adjustRevealSessionCounts(trackedRevealMeasuredSessionRef.current, { measuredCount: -1 });
        trackedRevealMeasuredRef.current = false;
      }
    };
  }, [hasMeasuredVisibility, revealSession]);

  useEffect(() => {
    const nextSession = revealSession ?? null;
    const shouldTrackPending = Boolean(nextSession)
      && status !== 'loaded'
      && status !== 'error'
      && hasMeasuredVisibility
      && initialViewportVisibilityRef.current === true;

    trackedRevealPendingSessionRef.current = nextSession;
    trackedRevealPendingRef.current = false;

    if (nextSession && shouldTrackPending) {
      adjustRevealSessionCounts(nextSession, { pendingCount: 1 });
      trackedRevealPendingRef.current = true;
    }

    return () => {
      if (trackedRevealPendingSessionRef.current && trackedRevealPendingRef.current) {
        adjustRevealSessionCounts(trackedRevealPendingSessionRef.current, { pendingCount: -1 });
        trackedRevealPendingRef.current = false;
      }
    };
  }, [hasMeasuredVisibility, revealSession, status]);

  if (hideOnError && status === 'error') {
    return null;
  }

  return (
    <img
      {...imgProps}
      ref={imgRef}
      src={status === 'loaded' ? src : PLACEHOLDER_PIXEL}
      alt={alt}
      className={status === 'loaded' ? className : `${className ?? ''} opacity-0`}
      width={width}
      height={height}
      decoding={decoding ?? 'async'}
      data-image-status={status}
    />
  );
}
