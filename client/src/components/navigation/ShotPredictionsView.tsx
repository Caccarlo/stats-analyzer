import { useEffect, useMemo, useState } from 'react';
import {
  getShotPredictionDetails,
  getTeamImageUrl,
  getTeamShotAverageCatalog,
  getTeamShotAverages,
} from '@/api/sofascore';
import { useNavigation } from '@/context/NavigationContext';
import type { ShotPredictionState } from '@/hooks/useShotPrediction';
import type {
  ShotAverageCatalog,
  ShotAverageSelection,
  ShotAverageVenue,
  ShotPredictionDetails,
  TeamShotAverages,
} from '@/types';

interface ShotPredictionsViewProps {
  eventId: number;
  homeTeamId: number;
  homeTeamName: string;
  awayTeamId: number;
  awayTeamName: string;
  leagueId?: number;
  leagueName?: string;
  seasonId?: number;
  seasonYear?: string;
  predictionState: ShotPredictionState;
  homeAverageSelection: ShotAverageSelection;
  awayAverageSelection: ShotAverageSelection;
  onHomeAverageSelectionChange: (selection: ShotAverageSelection) => void;
  onAwayAverageSelectionChange: (selection: ShotAverageSelection) => void;
}

interface AveragePanelProps {
  teamId: number;
  teamName: string;
  side: 'home' | 'away';
  matchCompetitionId?: number;
  matchSeasonId?: number;
  selection: ShotAverageSelection;
  onSelectionChange: (selection: ShotAverageSelection) => void;
}

const VALUE_LABELS: Record<string, string> = {
  expectedHome: 'Tiri attesi casa',
  expectedAway: 'Tiri attesi ospite',
  expectedTotal: 'Tiri totali attesi',
  baselineHome: 'Baseline casa (L_H)',
  baselineAway: 'Baseline trasferta (L_A)',
  homeAttack: 'Rating attacco casa',
  awayAttack: 'Rating attacco trasferta',
  homeVulnerability: 'Vulnerabilità difensiva casa',
  awayVulnerability: 'Vulnerabilità difensiva trasferta',
  betaAttack: 'Esponente attacco (βA)',
  betaDefense: 'Esponente difesa (βD)',
  halfLifeDays: 'Emivita temporale (giorni)',
  shrinkageMatches: 'Prior di shrinkage (m)',
  effectiveSampleHome: 'Campione effettivo casa',
  effectiveSampleAway: 'Campione effettivo ospite',
  strengthDifference: 'Differenza continua di forza (D)',
  strengthTerm: 'Termine di forza selezionato',
  promotionCorrection: 'Correzione neopromossa',
  distribution: 'Distribuzione del totale',
  selectedLine: 'Linea selezionata',
  selectedProbability: 'Probabilità completa',
  selectedFairOdds: 'Quota equa completa',
};

function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'N/D';
  return value.toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPercent(value: number): string {
  return `${(value * 100).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function selectClasses(): string {
  return 'min-w-0 w-full rounded-md border border-border bg-bg px-2.5 py-2 text-xs text-text-primary outline-none transition focus:border-neon focus:ring-2 focus:ring-neon/10';
}

function TeamLogo({ teamId, teamName, className = 'h-12 w-12' }: { teamId: number; teamName: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className={`${className} grid place-items-center rounded-full border border-border bg-bg text-xs font-semibold text-text-secondary`}>
      {teamName.slice(0, 2).toUpperCase()}
    </span>
  ) : (
    <img
      src={getTeamImageUrl(teamId)}
      alt={`Logo ${teamName}`}
      className={`${className} object-contain`}
      onError={() => setFailed(true)}
    />
  );
}

function AveragePanel({
  teamId,
  teamName,
  side,
  matchCompetitionId,
  matchSeasonId,
  selection,
  onSelectionChange,
}: AveragePanelProps) {
  const [catalog, setCatalog] = useState<ShotAverageCatalog | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [averageResult, setAverageResult] = useState<{
    key: string;
    data: TeamShotAverages | null;
    error: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTeamShotAverageCatalog(teamId)
      .then((response) => {
        if (cancelled) return;
        setCatalog(response);
        setCatalogStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setCatalogStatus('error');
      });
    return () => { cancelled = true; };
  }, [teamId]);

  const competitions = useMemo(() => {
    if (!catalog) return [];
    return [...catalog.competitions].sort((first, second) => {
      if (first.id === matchCompetitionId) return -1;
      if (second.id === matchCompetitionId) return 1;
      return 0;
    });
  }, [catalog, matchCompetitionId]);

  useEffect(() => {
    if (!competitions.length) return;
    const selectedCompetition = competitions.find((competition) => competition.id === selection.competitionId)
      ?? competitions.find((competition) => competition.id === matchCompetitionId)
      ?? competitions[0];
    const selectedSeason = selectedCompetition.seasons.find((season) => season.id === selection.seasonId)
      ?? selectedCompetition.seasons.find((season) => season.id === matchSeasonId)
      ?? selectedCompetition.seasons[0];
    if (
      selectedCompetition.id !== selection.competitionId
      || selectedSeason?.id !== selection.seasonId
    ) {
      onSelectionChange({
        competitionId: selectedCompetition.id,
        seasonId: selectedSeason?.id,
        venue: selection.venue,
      });
    }
  }, [competitions, matchCompetitionId, matchSeasonId, onSelectionChange, selection]);

  const selectedCompetition = competitions.find((competition) => competition.id === selection.competitionId);
  const averageRequestKey = `${teamId}:${selection.competitionId ?? 'none'}:${selection.seasonId ?? 'none'}:${selection.venue}`;
  const averageStatus: 'idle' | 'loading' | 'ready' | 'error' = !selection.competitionId || !selection.seasonId
    ? 'idle'
    : averageResult?.key !== averageRequestKey
      ? 'loading'
      : averageResult.error
        ? 'error'
        : 'ready';
  const averages = averageResult?.key === averageRequestKey ? averageResult.data : null;

  useEffect(() => {
    if (!selection.competitionId || !selection.seasonId) return;
    let cancelled = false;
    const requestKey = `${teamId}:${selection.competitionId}:${selection.seasonId}:${selection.venue}`;
    getTeamShotAverages(teamId, selection.competitionId, selection.seasonId, selection.venue)
      .then((response) => {
        if (cancelled) return;
        setAverageResult({ key: requestKey, data: response, error: false });
      })
      .catch(() => {
        if (!cancelled) setAverageResult({ key: requestKey, data: null, error: true });
      });
    return () => { cancelled = true; };
  }, [selection.competitionId, selection.seasonId, selection.venue, teamId]);

  const setCompetition = (competitionId: number) => {
    const competition = competitions.find((item) => item.id === competitionId);
    onSelectionChange({
      competitionId,
      seasonId: competition?.seasons[0]?.id,
      venue: selection.venue,
    });
  };

  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface/70 p-4" aria-labelledby={`average-${side}-title`}>
      <div className="mb-4 flex items-center gap-3">
        <TeamLogo teamId={teamId} teamName={teamName} className="h-9 w-9" />
        <div className="min-w-0">
          <h3 id={`average-${side}-title`} className="truncate text-sm font-semibold text-text-primary">{teamName}</h3>
          <p className="text-[11px] text-text-muted">Stagione più recente e precedente</p>
        </div>
      </div>

      {catalogStatus === 'loading' && <div className="h-20 animate-pulse rounded-lg bg-bg/70" />}
      {catalogStatus === 'error' && (
        <p className="rounded-lg border border-negative/30 bg-negative/5 px-3 py-4 text-xs text-text-secondary">
          Catalogo non disponibile. Riprova più tardi.
        </p>
      )}
      {catalogStatus === 'ready' && competitions.length === 0 && (
        <p className="rounded-lg border border-border bg-bg/50 px-3 py-4 text-xs text-text-secondary">N/D</p>
      )}
      {catalogStatus === 'ready' && competitions.length > 0 && (
        <>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <label className="min-w-0 text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
              Competizione
              <select
                className={`${selectClasses()} mt-1`}
                value={selection.competitionId ?? ''}
                onChange={(event) => setCompetition(Number(event.target.value))}
              >
                {competitions.map((competition) => (
                  <option key={competition.id} value={competition.id}>{competition.name}</option>
                ))}
              </select>
            </label>
            <label className="min-w-0 text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
              Stagione
              <select
                className={`${selectClasses()} mt-1`}
                value={selection.seasonId ?? ''}
                onChange={(event) => onSelectionChange({ ...selection, seasonId: Number(event.target.value) })}
              >
                {selectedCompetition?.seasons.map((season) => (
                  <option key={season.id} value={season.id}>{season.name || season.year}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3 grid grid-cols-3 rounded-lg border border-border bg-bg/50 p-1" aria-label={`Filtro sede ${teamName}`}>
            {(['all', 'home', 'away'] as ShotAverageVenue[]).map((venue) => (
              <button
                key={venue}
                type="button"
                onClick={() => onSelectionChange({ ...selection, venue })}
                className={`rounded-md px-2 py-1.5 text-xs transition ${
                  selection.venue === venue ? 'bg-neon/10 text-neon' : 'text-text-secondary hover:text-text-primary'
                }`}
                aria-pressed={selection.venue === venue}
              >
                {venue === 'all' ? 'Tutte' : venue === 'home' ? 'Casa' : 'Trasferta'}
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
            {[
              ['Partite', averages?.matches ?? null, 0],
              ['Tiri fatti', averages?.shotsFor ?? null, 1],
              ['Tiri subiti', averages?.shotsAgainst ?? null, 1],
              ['Totale medio', averages?.totalShots ?? null, 1],
            ].map(([label, value, digits]) => (
              <div key={String(label)} className="bg-bg/80 px-3 py-3 text-center">
                <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
                <p className="mt-1 font-mono text-lg font-semibold text-text-primary">
                  {averageStatus === 'loading' ? '···' : averageStatus === 'error' ? 'N/D' : formatNumber(value as number | null, digits as number)}
                </p>
              </div>
            ))}
          </div>
          {averageStatus === 'ready' && averages && averages.excludedMissing > 0 && (
            <p className="mt-2 text-[10px] text-text-muted">{averages.excludedMissing} gare senza statistiche complete escluse.</p>
          )}
        </>
      )}
    </section>
  );
}

function LoadingPrediction({ state }: { state: ShotPredictionState }) {
  const completed = state.progress?.completed ?? 0;
  const total = Math.max(1, state.progress?.total ?? 1);
  const percentage = Math.min(100, Math.round((completed / total) * 100));
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neon">Modello point-in-time</p>
          <h2 className="mt-1 text-lg font-semibold text-text-primary">Preparazione della previsione</h2>
          <p className="mt-1 text-sm text-text-secondary">{state.progress?.message ?? 'Raccolta dello storico precedente alla partita'}</p>
        </div>
        <span className="font-mono text-sm text-neon">{percentage}%</span>
      </div>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-bg">
        <div className="h-full rounded-full bg-neon transition-all duration-500" style={{ width: `${Math.max(3, percentage)}%` }} />
      </div>
      <p className="mt-3 text-xs text-text-muted">Il lavoro continua sul server anche se cambi pagina.</p>
    </section>
  );
}

function ErrorPrediction({ state }: { state: ShotPredictionState }) {
  const insufficient = state.error?.code === 'unsupported_or_insufficient_data' || state.error?.status === 422;
  return (
    <section className="rounded-xl border border-negative/30 bg-negative/5 p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-negative">
        {insufficient ? 'Storico insufficiente o competizione non supportata' : 'Previsione non disponibile'}
      </p>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">{state.error?.message}</p>
      <button
        type="button"
        onClick={state.retry}
        className="mt-4 rounded-md border border-negative/40 px-3 py-2 text-xs font-medium text-text-primary transition hover:bg-negative/10 focus:outline-none focus:ring-2 focus:ring-negative/30"
      >
        Riprova il calcolo
      </button>
    </section>
  );
}

function renderDetailValue(value: unknown): string {
  if (value === null || value === undefined) return 'N/D';
  if (typeof value === 'number') return value.toLocaleString('it-IT', { maximumFractionDigits: 8 });
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Sì' : 'No';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.type === 'negative-binomial') return `Binomiale negativa (dispersione ${renderDetailValue(record.dispersion)})`;
    if (record.type === 'poisson') return 'Poisson';
    if (typeof record.note === 'string') return record.note;
  }
  return JSON.stringify(value);
}

function PredictionDetailsPanel({
  eventId,
  selection,
  initialSource,
  homeTeamName,
  awayTeamName,
  onClose,
}: {
  eventId: number;
  selection: string;
  initialSource: 'home' | 'away';
  homeTeamName: string;
  awayTeamName: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'calculation' | 'matches'>('calculation');
  const [source, setSource] = useState<'home' | 'away'>(initialSource);
  const [page, setPage] = useState(1);
  const [requestResult, setRequestResult] = useState<{
    key: string;
    details: ShotPredictionDetails | null;
    error: boolean;
  } | null>(null);
  const requestKey = `${eventId}:${selection}:${source}:${page}`;
  const loading = requestResult?.key !== requestKey;
  const error = requestResult?.key === requestKey && requestResult.error;
  const details = requestResult?.key === requestKey ? requestResult.details : null;

  useEffect(() => {
    let cancelled = false;
    const activeKey = `${eventId}:${selection}:${source}:${page}`;
    getShotPredictionDetails(eventId, selection, source, page)
      .then((response) => {
        if (!cancelled) setRequestResult({ key: activeKey, details: response, error: false });
      })
      .catch(() => {
        if (!cancelled) setRequestResult({ key: activeKey, details: null, error: true });
      });
    return () => { cancelled = true; };
  }, [eventId, page, selection, source]);

  const totalPages = Math.max(1, Math.ceil((details?.matches.total ?? 0) / 25));

  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-neon/30 bg-surface shadow-[0_0_30px_rgba(74,222,128,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex rounded-lg bg-bg p-1" role="tablist" aria-label="Dettagli previsione">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'calculation'}
            onClick={() => setTab('calculation')}
            className={`rounded-md px-3 py-1.5 text-xs ${tab === 'calculation' ? 'bg-neon/10 text-neon' : 'text-text-secondary'}`}
          >
            Calcolo
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'matches'}
            onClick={() => setTab('matches')}
            className={`rounded-md px-3 py-1.5 text-xs ${tab === 'matches' ? 'bg-neon/10 text-neon' : 'text-text-secondary'}`}
          >
            Partite usate
          </button>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-text-muted hover:bg-bg hover:text-text-primary" aria-label="Chiudi dettagli">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>

      {loading && <div className="m-4 h-40 animate-pulse rounded-lg bg-bg/70" />}
      {error && <p className="m-4 rounded-lg bg-negative/5 p-4 text-sm text-text-secondary">Dettagli non disponibili.</p>}
      {!loading && !error && details && tab === 'calculation' && (
        <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Formula centrale</p>
            <code className="mt-2 block overflow-x-auto rounded-lg border border-border bg-bg p-3 text-xs leading-6 text-neon">
              {details.calculation.formula}
            </code>
            <dl className="mt-4 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
              {Object.entries(details.calculation.values).map(([key, value]) => (
                <div key={key} className="flex items-start justify-between gap-3 bg-bg/90 px-3 py-2.5">
                  <dt className="text-xs text-text-secondary">{VALUE_LABELS[key] ?? key}</dt>
                  <dd className="text-right font-mono text-xs text-text-primary">{renderDetailValue(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">Dalla media alla quota</p>
            {details.calculation.probabilitySteps.length > 0 ? (
              <ol className="mt-2 space-y-2">
                {details.calculation.probabilitySteps.map((step, index) => (
                  <li key={step} className="flex gap-3 rounded-lg border border-border bg-bg/60 p-3 text-xs leading-5 text-text-secondary">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-neon/10 font-mono text-[10px] text-neon">{index + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 rounded-lg border border-border bg-bg/60 p-3 text-xs leading-5 text-text-secondary">
                Il valore atteso deriva dai rating corretti per avversaria, pesati nel tempo e ridotti verso la media del campionato.
              </p>
            )}
            <div className="mt-4 rounded-lg border border-border bg-bg/60 p-3 text-xs leading-5 text-text-secondary">
              <p><span className="text-text-muted">Versione:</span> {details.calculation.modelVersion}</p>
              <p><span className="text-text-muted">Cutoff:</span> {formatDate(details.calculation.cutoffTimestamp)}</p>
              <p><span className="text-text-muted">Backtest:</span> {details.calculation.backtest.sampleSize} previsioni fuori campione</p>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && details && tab === 'matches' && (
        <div className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex rounded-lg bg-bg p-1">
              {(['home', 'away'] as const).map((teamSide) => (
                <button
                  key={teamSide}
                  type="button"
                  onClick={() => { setSource(teamSide); setPage(1); }}
                  className={`rounded-md px-3 py-1.5 text-xs ${source === teamSide ? 'bg-neon/10 text-neon' : 'text-text-secondary'}`}
                >
                  {teamSide === 'home' ? homeTeamName : awayTeamName}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-muted">{details.matches.total} partite prima del cutoff</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[980px] border-collapse text-left text-xs">
              <thead className="bg-bg text-[10px] uppercase tracking-wide text-text-muted">
                <tr>
                  {['Data', 'Competizione', 'Partita', 'Sede', 'Fatti', 'Subiti', 'Totale', 'Giorni', 'Peso', 'Forza avv.', 'Contributo'].map((label) => (
                    <th key={label} className="px-3 py-2.5 font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {details.matches.items.map((match) => (
                  <tr key={match.eventId} className="border-t border-border text-text-secondary">
                    <td className="whitespace-nowrap px-3 py-2.5">{new Date(match.startTimestamp * 1000).toLocaleDateString('it-IT')}</td>
                    <td className="px-3 py-2.5">{match.competition}</td>
                    <td className="px-3 py-2.5 text-text-primary">{match.match}</td>
                    <td className="px-3 py-2.5">{match.venue === 'home' ? 'Casa' : 'Trasferta'}</td>
                    <td className="px-3 py-2.5 font-mono">{match.shotsFor}</td>
                    <td className="px-3 py-2.5 font-mono">{match.shotsAgainst}</td>
                    <td className="px-3 py-2.5 font-mono">{match.totalShots}</td>
                    <td className="px-3 py-2.5 font-mono">{formatNumber(match.daysFromCutoff, 0)}</td>
                    <td className="px-3 py-2.5 font-mono">{formatNumber(match.temporalWeight, 4)}</td>
                    <td className="px-3 py-2.5 font-mono">{formatNumber(match.opponentPointInTimeStrength, 3)}</td>
                    <td className="px-3 py-2.5 font-mono">{formatNumber(match.ratingContribution, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary disabled:opacity-30">Indietro</button>
            <span className="font-mono text-xs text-text-muted">{page} / {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary disabled:opacity-30">Avanti</button>
          </div>
        </div>
      )}
    </section>
  );
}

export default function ShotPredictionsView(props: ShotPredictionsViewProps) {
  const { goBack } = useNavigation();
  const { predictionState } = props;
  const prediction = predictionState.prediction;
  const [selection, setSelection] = useState<{ key: string; source: 'home' | 'away' } | null>(null);

  const toggleSelection = (key: string, source: 'home' | 'away') => {
    setSelection((current) => current?.key === key ? null : { key, source });
  };

  return (
    <main className="min-h-full bg-bg px-3 py-4 sm:px-5 lg:px-7 lg:py-6">
      <div className="mx-auto max-w-[1380px]">
        <header className="mb-5 flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <button
              type="button"
              onClick={() => goBack(0)}
              className="mb-3 inline-flex items-center gap-1.5 text-xs text-text-muted transition hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-neon/20"
            >
              <span aria-hidden="true">←</span> Indietro
            </button>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-neon">
              <span className="h-1.5 w-1.5 rounded-full bg-neon shadow-[0_0_8px_rgba(74,222,128,0.8)]" />
              Previsione pre-partita · Tiri totali
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">
              {props.homeTeamName} <span className="font-normal text-text-muted">vs</span> {props.awayTeamName}
            </h1>
            <p className="mt-1 text-xs text-text-muted">
              {props.leagueName ?? 'Competizione'}{props.seasonYear ? ` · ${props.seasonYear}` : ''}
            </p>
          </div>
          {prediction && (
            <div className="rounded-lg border border-border bg-surface px-3 py-2 text-right text-[10px] leading-4 text-text-muted">
              <p>Cutoff pre-partita</p>
              <p className="font-mono text-xs text-text-secondary">{formatDate(prediction.cutoffTimestamp)}</p>
            </div>
          )}
        </header>

        {predictionState.status === 'building' && <LoadingPrediction state={predictionState} />}
        {predictionState.status === 'error' && <ErrorPrediction state={predictionState} />}

        {predictionState.status === 'ready' && prediction && (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Risultati principali">
              <button
                type="button"
                onClick={() => toggleSelection('expected-home', 'home')}
                className={`group rounded-xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-neon/30 ${selection?.key === 'expected-home' ? 'border-neon bg-neon/5' : 'border-border bg-surface hover:border-neon/50'}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <TeamLogo teamId={props.homeTeamId} teamName={props.homeTeamName} />
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Tiri attesi casa</p>
                      <p className="mt-1 truncate text-sm font-medium text-text-primary">{props.homeTeamName}</p>
                    </div>
                  </div>
                  <p className="font-mono text-3xl font-semibold text-neon">{formatNumber(prediction.expected.home)}</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => toggleSelection('expected-away', 'away')}
                className={`group rounded-xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-neon/30 ${selection?.key === 'expected-away' ? 'border-neon bg-neon/5' : 'border-border bg-surface hover:border-neon/50'}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <TeamLogo teamId={props.awayTeamId} teamName={props.awayTeamName} />
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Tiri attesi ospite</p>
                      <p className="mt-1 truncate text-sm font-medium text-text-primary">{props.awayTeamName}</p>
                    </div>
                  </div>
                  <p className="font-mono text-3xl font-semibold text-neon">{formatNumber(prediction.expected.away)}</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => toggleSelection('expected-total', 'home')}
                className={`rounded-xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-neon/30 sm:col-span-2 lg:col-span-1 ${selection?.key === 'expected-total' ? 'border-neon bg-neon/5' : 'border-border bg-surface hover:border-neon/50'}`}
              >
                <div className="flex h-full items-center justify-between gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Tiri totali attesi</p>
                    <p className="mt-2 font-mono text-3xl font-semibold text-text-primary">{formatNumber(prediction.expected.total)}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-bg/70 px-3 py-2 text-right">
                    <p className="text-[9px] uppercase tracking-wide text-text-muted">Intervallo 80%</p>
                    <p className="mt-1 font-mono text-sm text-neon">{prediction.expected.interval80[0]}–{prediction.expected.interval80[1]}</p>
                  </div>
                </div>
              </button>
            </section>

            <section className="mt-4 overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby="total-market-title">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Mercato modellato</p>
                  <h2 id="total-market-title" className="mt-0.5 text-sm font-semibold text-text-primary">Tiri totali partita</h2>
                </div>
                <p className="text-[10px] text-text-muted">Quote eque · nessun margine bookmaker</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-right text-xs">
                  <thead className="bg-bg/70 text-[10px] uppercase tracking-wide text-text-muted">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium">Linea</th>
                      <th className="px-4 py-2.5 font-medium">Probabilità Under</th>
                      <th className="px-4 py-2.5 font-medium">Quota equa Under</th>
                      <th className="px-4 py-2.5 font-medium">Probabilità Over</th>
                      <th className="px-4 py-2.5 font-medium">Quota equa Over</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prediction.markets.map((market) => {
                      const underKey = `under:${market.line}`;
                      const overKey = `over:${market.line}`;
                      return (
                        <tr key={market.line} className={`border-t border-border ${market.isMain ? 'bg-neon/[0.045]' : ''}`}>
                          <td className="px-4 py-2.5 text-left">
                            <span className={`font-mono text-sm font-semibold ${market.isMain ? 'text-neon' : 'text-text-primary'}`}>
                              {formatNumber(market.line)}
                            </span>
                            {market.isMain && <span className="ml-2 rounded bg-neon/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-neon">Equa</span>}
                          </td>
                          <td className="p-1.5">
                            <button type="button" onClick={() => toggleSelection(underKey, 'home')} className={`w-full rounded px-2.5 py-1.5 font-mono transition hover:bg-bg ${selection?.key === underKey ? 'bg-neon/10 text-neon' : 'text-text-secondary'}`}>
                              {formatPercent(market.underProbability)}
                            </button>
                          </td>
                          <td className="p-1.5">
                            <button type="button" onClick={() => toggleSelection(underKey, 'home')} className={`w-full rounded px-2.5 py-1.5 font-mono transition hover:bg-bg ${selection?.key === underKey ? 'bg-neon/10 text-neon' : 'text-text-primary'}`}>
                              {formatNumber(market.underFairOdds, 2)}
                            </button>
                          </td>
                          <td className="p-1.5">
                            <button type="button" onClick={() => toggleSelection(overKey, 'away')} className={`w-full rounded px-2.5 py-1.5 font-mono transition hover:bg-bg ${selection?.key === overKey ? 'bg-neon/10 text-neon' : 'text-text-secondary'}`}>
                              {formatPercent(market.overProbability)}
                            </button>
                          </td>
                          <td className="p-1.5">
                            <button type="button" onClick={() => toggleSelection(overKey, 'away')} className={`w-full rounded px-2.5 py-1.5 font-mono transition hover:bg-bg ${selection?.key === overKey ? 'bg-neon/10 text-neon' : 'text-text-primary'}`}>
                              {formatNumber(market.overFairOdds, 2)}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {prediction.diagnostics.warnings.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs leading-5 text-text-secondary">
                {prediction.diagnostics.warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            )}

            {selection && (
              <PredictionDetailsPanel
                key={`${selection.key}:${selection.source}`}
                eventId={props.eventId}
                selection={selection.key}
                initialSource={selection.source}
                homeTeamName={props.homeTeamName}
                awayTeamName={props.awayTeamName}
                onClose={() => setSelection(null)}
              />
            )}
          </>
        )}

        <section className="mt-7" aria-labelledby="descriptive-averages-title">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Contesto, non input manuale</p>
              <h2 id="descriptive-averages-title" className="mt-0.5 text-sm font-semibold text-text-primary">Medie delle squadre</h2>
            </div>
            <p className="max-w-xl text-right text-[10px] leading-4 text-text-muted">
              Questi filtri sono descrittivi, usano i dati oggi disponibili e non modificano la previsione.
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <AveragePanel
              teamId={props.homeTeamId}
              teamName={props.homeTeamName}
              side="home"
              matchCompetitionId={props.leagueId}
              matchSeasonId={props.seasonId}
              selection={props.homeAverageSelection}
              onSelectionChange={props.onHomeAverageSelectionChange}
            />
            <AveragePanel
              teamId={props.awayTeamId}
              teamName={props.awayTeamName}
              side="away"
              matchCompetitionId={props.leagueId}
              matchSeasonId={props.seasonId}
              selection={props.awayAverageSelection}
              onSelectionChange={props.onAwayAverageSelectionChange}
            />
          </div>
        </section>

        <p className="mt-6 border-t border-border pt-4 text-[10px] leading-4 text-text-muted">
          Le stime sono probabilistiche e non costituiscono una certezza. La V1 non usa quote bookmaker, formazioni o assenze e non calcola EV.
        </p>
      </div>
    </main>
  );
}
