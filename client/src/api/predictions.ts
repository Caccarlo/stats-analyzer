import type {
  ShotAverageCatalog,
  ShotAverageVenue,
  ShotPredictionDetails,
  ShotPredictionResponse,
  ShotPredictionTargetSnapshot,
  TeamShotAverages,
} from '@/types';

export class StatsAnalyzerApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'StatsAnalyzerApiError';
    this.status = status;
    this.code = code;
  }
}

async function localApiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => null) as (T & { message?: string; code?: string }) | null;
  if (!response.ok || !data) {
    throw new StatsAnalyzerApiError(
      data?.message || `Richiesta non riuscita (${response.status}).`,
      response.status,
      data?.code,
    );
  }
  return data;
}

export function startShotPrediction(
  eventId: number,
  target: ShotPredictionTargetSnapshot,
  retry = false,
): Promise<ShotPredictionResponse> {
  return localApiFetch<ShotPredictionResponse>(
    `/api/predictions/shots/${eventId}${retry ? '?retry=1' : ''}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    },
  );
}

export function getShotPredictionStatus(eventId: number): Promise<ShotPredictionResponse> {
  return localApiFetch<ShotPredictionResponse>(`/api/predictions/shots/${eventId}`);
}

export function getShotPredictionDetails(
  eventId: number,
  selection: string,
  source: 'home' | 'away',
  page: number,
): Promise<ShotPredictionDetails> {
  const query = new URLSearchParams({
    selection,
    source,
    page: String(page),
    pageSize: '25',
  });
  return localApiFetch<ShotPredictionDetails>(`/api/predictions/shots/${eventId}/details?${query}`);
}

export function getTeamShotAverageCatalog(teamId: number, teamName: string): Promise<ShotAverageCatalog> {
  const query = new URLSearchParams({ teamName });
  return localApiFetch<ShotAverageCatalog>(`/api/teams/${teamId}/shot-averages/catalog?${query}`);
}

export function getTeamShotAverages(
  teamId: number,
  competitionId: number,
  seasonId: number,
  venue: ShotAverageVenue,
  teamName: string,
): Promise<TeamShotAverages> {
  const query = new URLSearchParams({
    competitionId: String(competitionId),
    seasonId: String(seasonId),
    venue,
    teamName,
  });
  return localApiFetch<TeamShotAverages>(`/api/teams/${teamId}/shot-averages?${query}`);
}
