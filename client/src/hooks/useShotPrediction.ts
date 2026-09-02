import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getShotPredictionStatus,
  startShotPrediction,
  StatsAnalyzerApiError,
} from '@/api/predictions';
import type { ShotPrediction, ShotPredictionTargetSnapshot } from '@/types';

export interface ShotPredictionState {
  status: 'idle' | 'building' | 'ready' | 'error';
  prediction: ShotPrediction | null;
  progress: { stage: string; message: string; completed: number; total: number } | null;
  error: { message: string; code?: string; status?: number } | null;
  retry: () => void;
}

export function useShotPrediction(
  eventId: number,
  enabled = true,
  target?: ShotPredictionTargetSnapshot,
): ShotPredictionState {
  const generationRef = useRef(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const [status, setStatus] = useState<ShotPredictionState['status']>('idle');
  const [prediction, setPrediction] = useState<ShotPrediction | null>(null);
  const [progress, setProgress] = useState<ShotPredictionState['progress']>(null);
  const [error, setError] = useState<ShotPredictionState['error']>(null);

  const retry = useCallback(() => {
    setRetryNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let timeoutId: number | undefined;
    let cancelled = false;
    let polls = 0;

    const load = async (force: boolean) => {
      try {
        if (polls === 0) {
          setStatus('building');
          setPrediction(null);
          setProgress(null);
          setError(null);
        }
        if (polls === 0 && !target) {
          throw new StatsAnalyzerApiError(
            'La partita aperta non contiene tutti i dati necessari per la previsione.',
            422,
            'invalid_target_snapshot',
          );
        }
        const response = polls === 0
          ? await startShotPrediction(eventId, target as ShotPredictionTargetSnapshot, force)
          : await getShotPredictionStatus(eventId);
        if (cancelled || generationRef.current !== generation) return;
        if (response.status === 'ready') {
          setPrediction(response.prediction);
          setProgress(null);
          setStatus('ready');
          return;
        }
        polls += 1;
        setStatus('building');
        setProgress(response.progress);
        const delay = polls < 10 ? 1_500 : polls < 30 ? 2_500 : 5_000;
        timeoutId = window.setTimeout(() => void load(false), delay);
      } catch (caught) {
        if (cancelled || generationRef.current !== generation) return;
        const apiError = caught instanceof StatsAnalyzerApiError ? caught : null;
        setStatus('error');
        setProgress(null);
        setError({
          message: caught instanceof Error ? caught.message : 'Errore durante il calcolo della previsione.',
          code: apiError?.code,
          status: apiError?.status,
        });
      }
    };

    void load(retryNonce > 0);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [enabled, eventId, retryNonce, target]);

  return { status, prediction, progress, error, retry };
}
