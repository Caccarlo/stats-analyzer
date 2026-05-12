import {
  useEffect,
  useRef,
  useState,
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

interface PriorityImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'loading'> {
  src: string;
  expansionPriorityToken?: number;
  hideOnError?: boolean;
  loadScope?: string;
}

const PLACEHOLDER_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const HIGH_PRIORITY_CONCURRENCY = 6;
const WARM_PRIORITY_CONCURRENCY = 2;
const IMAGE_LOAD_TIMEOUT_MS = 15000;

const imageRecords = new Map<string, ImageRecord>();
const scopeRecords = new Map<string, ScopeRecord>();

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

export function usePriorityImageScopePending(scope: string | null | undefined): boolean {
  const normalizedScope = scope ?? null;
  const [pending, setPending] = useState(() => (
    normalizedScope ? getScopePendingCount(normalizedScope) > 0 : false
  ));

  useEffect(() => {
    if (!normalizedScope) {
      setPending(false);
      return undefined;
    }

    setPending(getScopePendingCount(normalizedScope) > 0);
    return subscribeToScope(normalizedScope, () => {
      setPending(getScopePendingCount(normalizedScope) > 0);
    });
  }, [normalizedScope]);

  return pending;
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
  ...imgProps
}: PriorityImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<LoadStatus>(() => getImageStatus(src));
  const [isVisible, setIsVisible] = useState(false);
  const [hasMeasuredVisibility, setHasMeasuredVisibility] = useState(false);
  const lastExpansionTokenRef = useRef(expansionPriorityToken);
  const trackedScopeRef = useRef<string | null>(null);
  const trackedPendingRef = useRef(false);

  useEffect(() => {
    setStatus(getImageStatus(src));
    return subscribeToImage(src, () => {
      setStatus(getImageStatus(src));
    });
  }, [src]);

  useEffect(() => {
    const node = imgRef.current;
    if (!node) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      setHasMeasuredVisibility(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsVisible(Boolean(entry?.isIntersecting));
        setHasMeasuredVisibility(true);
      },
      {
        threshold: 0.01,
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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
