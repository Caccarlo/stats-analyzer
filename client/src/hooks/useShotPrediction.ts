import { useCallback, useEffect, useRef, useState } from 'react';
import { getShotPrediction, StatsAnalyzerApiError } from '@/api/sofascore';
import type { ShotPrediction } from '@/types';

export interface ShotPredictionState {
  status: 'idle' | 'building' | 'ready' | 'error';
  prediction: ShotPrediction | null;
  progress: { stage: string; message: string; completed: number; total: number } | null;
  error: { message: string; code?: string; status?: number } | null;
  retry: () => void;
}

export function useShotPrediction(eventId: number): ShotPredictionState {
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
        const response = await getShotPrediction(eventId, force);
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
  }, [eventId, retryNonce]);

  return { status, prediction, progress, error, retry };
}
