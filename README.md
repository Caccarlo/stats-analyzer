# Stats Analyzer

Applicazione web per l'analisi statistica dei **falli** nel calcio. Permette di esplorare dati su giocatori, squadre e campionati, con focus sulle statistiche dei falli commessi e subiti, analisi partita per partita e visualizzazione delle posizioni in campo.

I dati provengono dall'API di [SofaScore](https://www.sofascore.com).

---

## Indice

- [Funzionalità](#funzionalità)
- [Tech Stack](#tech-stack)
- [Struttura del progetto](#struttura-del-progetto)
- [Installazione e avvio](#installazione-e-avvio)
- [Architettura](#architettura)
  - [Flusso di navigazione](#flusso-di-navigazione)
  - [Paesi e campionati disponibili](#paesi-e-campionati-disponibili)
  - [Split View](#split-view)
  - [Gestione dello stato](#gestione-dello-stato)
  - [Flusso dati e API](#flusso-dati-e-api)
  - [Caching e performance](#caching-e-performance)
- [Pagine e componenti](#pagine-e-componenti)
  - [Pagine](#pagine)
  - [Layout](#layout)
  - [Navigazione](#navigazione)
  - [Player](#player)
  - [Common](#common)
- [Logica di business](#logica-di-business)
  - [Calcolo statistiche](#calcolo-statistiche)
  - [Estrazione falli](#estrazione-falli)
  - [Mapping posizioni campo](#mapping-posizioni-campo)
- [Tema e stile](#tema-e-stile)

---

## Funzionalità

- **Navigazione gerarchica**: Paesi → Campionati → Squadre → Rosa/Formazione → Giocatore
- **Ricerca giocatori**: barra di ricerca globale con debounce (500ms) che interroga l'API SofaScore
- **Statistiche falli aggregate**: totali, per partita e per 90 minuti, calcolate su più tornei e stagioni
- **Filtri**: anno di stagione, singoli tornei, tipo di fallo (commessi / subiti)
- **Analisi partita per partita**: lista di match con card espandibili che mostrano:
  - Falli individuali con minuto, avversario coinvolto e zona del campo
  - Falli di mano identificati separatamente
  - Minuti di ingresso/uscita per sostituzione
  - Mappa SVG del campo con posizioni medie dei giocatori
- **Vista squadra**: rosa completa e formazione della prossima partita visualizzata su campo
- **Split View**: su desktop (lg+) si può aprire un secondo pannello per confrontare due giocatori
- **Interfaccia in italiano**

---

## Tech Stack

| Livello    | Tecnologia                                |
| ---------- | ----------------------------------------- |
| Frontend   | React 19, TypeScript 5.9, Vite 8          |
| Stile      | Tailwind CSS 4 (tema dark custom)         |
| Stato      | React Context API + useReducer            |
| Backend    | Express.js 4 (proxy verso SofaScore API)  |
| API esterna| SofaScore REST API                        |
| Monorepo   | concurrently (client + server)            |

---

## Struttura del progetto

```
stats-analyzer/
├── package.json              # Script monorepo (start, install:all)
├── client/                   # Frontend React
│   ├── src/
│   │   ├── App.tsx                          # Root component con routing a pannelli
│   │   ├── main.tsx                         # Entry point
│   │   ├── index.css                        # Tema Tailwind e variabili CSS
│   │   ├── pages/
│   │   │   ├── HomePage.tsx                 # Schermata iniziale con ricerca
│   │   │   └── PlayerPage.tsx               # Pagina analisi giocatore
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── Sidebar.tsx              # Sidebar sinistra (navigazione)
│   │   │   │   ├── ContentPanel.tsx         # Area contenuto principale
│   │   │   │   └── SearchBar.tsx            # Ricerca giocatori con dropdown
│   │   │   ├── navigation/
│   │   │   │   ├── CountryList.tsx          # Lista paesi
│   │   │   │   ├── LeagueList.tsx           # Lista campionati per paese
│   │   │   │   ├── TeamGrid.tsx             # Griglia squadre per campionato
│   │   │   │   ├── TeamView.tsx             # Rosa + formazione prossima partita
│   │   │   │   └── SidebarTeamList.tsx      # Lista compatta squadre in sidebar
│   │   │   ├── player/
│   │   │   │   ├── PlayerHeader.tsx         # Avatar, nome, squadra, ruolo
│   │   │   │   ├── PlayerFilters.tsx        # Filtri stagione/torneo/tipo fallo
│   │   │   │   ├── StatsOverview.tsx        # Griglia 3×2 statistiche aggregate
│   │   │   │   ├── MatchList.tsx            # Lista partite paginata
│   │   │   │   ├── MatchCard.tsx            # Card espandibile con dettagli falli
│   │   │   │   └── FieldMap.tsx             # Campo SVG con posizioni giocatori
│   │   │   └── common/
│   │   │       ├── Badge.tsx                # Badge stilizzato (default/neon/negative)
│   │   │       └── PlayerDot.tsx            # Cerchio SVG posizione giocatore
│   │   ├── context/
│   │   │   └── NavigationContext.tsx         # Stato navigazione + pannelli
│   │   ├── hooks/
│   │   │   ├── usePlayerData.ts             # Fetch e cache dati giocatore
│   │   │   └── useMatchDetails.ts           # Fetch e cache dettagli partita
│   │   ├── api/
│   │   │   └── sofascore.ts                 # Client API con cache e retry
│   │   ├── utils/
│   │   │   ├── statsCalculator.ts           # Aggregazione statistiche
│   │   │   ├── foulPairing.ts               # Estrazione e pairing falli
│   │   │   └── positionMapping.ts           # Coordinate campo e formazioni
│   │   └── types/
│   │       └── index.ts                     # Tipi TypeScript
│   ├── vite.config.ts                       # Porta 5173, proxy /api → :3001
│   └── package.json
└── server/
    ├── index.js                             # Express proxy per SofaScore
    └── package.json
```

---

## Installazione e avvio

```bash
# 1. Installare le dipendenze (root + client + server)
npm run install:all

# 2. Avviare l'applicazione (client Vite su :5173, server Express su :3001)
npm start
```

Il client Vite è configurato per fare proxy delle chiamate `/api/*` verso `http://localhost:3001`.

### Script disponibili

| Script            | Descrizione                                      |
| ----------------- | ------------------------------------------------ |
| `npm start`       | Avvia client e server in parallelo               |
| `npm run dev:client` | Solo frontend Vite (porta 5173)               |
| `npm run dev:server` | Solo server Express con --watch (porta 3001)  |
| `npm run install:all`| Installa dipendenze di client e server        |

Nel client:

| Script            | Descrizione                    |
| ----------------- | ------------------------------ |
| `npm run build`   | Build TypeScript + Vite        |
| `npm run lint`    | ESLint                         |
| `npm run preview` | Preview della build di prod    |

---

## Architettura

### Flusso di navigazione

L'app non usa un router tradizionale. La navigazione è gestita interamente tramite stato (`NavigationContext`) con una gerarchia di viste:

```
home → leagues → teams → team → player
```

1. **Home**: schermata iniziale con barra di ricerca e hint per iniziare dalla sidebar
2. **Leagues**: selezionato un paese, mostra i suoi campionati
3. **Teams**: selezionato un campionato, mostra le squadre (dalla classifica)
4. **Team**: selezionata una squadra, mostra rosa + formazione prossima partita
5. **Player**: selezionato un giocatore, mostra le sue statistiche falli

La navigazione indietro (`GO_BACK`) risale la gerarchia. Ogni livello memorizza il contesto (paese, campionato, stagione, squadra) per poter tornare indietro correttamente.

### Paesi e campionati disponibili

I paesi e i relativi campionati sono **hardcoded** nell'app:

| Paese      | Campionati                                        |
| ---------- | ------------------------------------------------- |
| Italia     | Serie A (23), Serie B (53)                        |
| Inghilterra| Premier League (17), Championship (18)            |
| Spagna     | La Liga (8), La Liga 2 (54)                       |
| Germania   | Bundesliga (35), 2. Bundesliga (44)               |
| Francia    | Ligue 1 (34), Ligue 2 (182)                       |
| Europa     | Champions League (7), Europa League (679), Conference League (17015), Supercoppa UEFA (341) |

I numeri tra parentesi sono gli ID dei tornei su SofaScore (`unique-tournament`).

### Split View

Su schermi desktop (breakpoint `lg`, 1024px+) l'app supporta due pannelli affiancati:

- **Pannello 0** (principale): navigazione completa o vista giocatore
- **Pannello 1** (secondario): aperto con `openSplitPlayer()`, mostra un secondo giocatore

Questo permette il confronto visivo tra due giocatori. Il pannello secondario si chiude con `closeSplit()`.

### Gestione dello stato

Lo stato è centralizzato in `NavigationContext` tramite `useReducer`. Lo state contiene un array `panels` con lo stato di ciascun pannello.

**Azioni del reducer:**

| Azione        | Descrizione                                       |
| ------------- | ------------------------------------------------- |
| `SET_VIEW`    | Naviga a una nuova vista con dati associati       |
| `GO_BACK`     | Torna al livello gerarchico precedente            |
| `OPEN_SPLIT`  | Apre il secondo pannello con un giocatore         |
| `CLOSE_SPLIT` | Chiude il secondo pannello                        |
| `RESET`       | Riporta tutto allo stato iniziale                 |

**Helper esposti dal context:**

- `navigateTo(panel, view, data)` — navigazione generica
- `selectCountry(panel, countryId, name)` — seleziona paese
- `selectLeague(panel, leagueId, name, seasonId)` — seleziona campionato
- `selectTeam(panel, teamId, name)` — seleziona squadra
- `selectPlayer(panel, playerId, playerData)` — seleziona giocatore
- `openSplitPlayer(player)` / `closeSplit()` — gestione split view

### Flusso dati e API

```
Browser ←→ Vite Dev Server (:5173)
                ↓ proxy /api/*
           Express Proxy (:3001)
                ↓ fetch con headers
           SofaScore API (sofascore.com/api/v1)
```

Il server Express funge da proxy per aggirare le restrizioni CORS di SofaScore. Aggiunge headers appropriati (`User-Agent`, `Referer`, ecc.) e serve anche le immagini con cache headers.

**Route del proxy:**

| Route              | Target                                    | Uso                      |
| ------------------ | ----------------------------------------- | ------------------------ |
| `GET /api/sofascore/*` | `sofascore.com/api/v1/*`              | Dati JSON                |
| `GET /api/img/*`       | `api.sofascore.app/api/v1/*`          | Immagini (loghi, avatar) |

**Principali endpoint SofaScore utilizzati:**

| Endpoint                                                       | Descrizione                        |
| -------------------------------------------------------------- | ---------------------------------- |
| `unique-tournament/{id}/seasons`                               | Stagioni di un torneo              |
| `unique-tournament/{id}/season/{id}/standings/total`           | Classifica (per ottenere le squadre) |
| `team/{id}/players`                                            | Rosa della squadra                 |
| `team/{id}/events/next/0`                                      | Prossima partita                   |
| `event/{id}/lineups`                                           | Formazioni                         |
| `event/{id}/comments`                                          | Cronaca testuale (falli, sostituzioni) |
| `event/{id}/average-positions`                                 | Posizioni medie giocatori          |
| `player/{id}/statistics/seasons`                               | Tornei e stagioni del giocatore    |
| `player/{id}/unique-tournament/{id}/season/{id}/statistics/overall` | Statistiche stagionali       |
| `player/{id}/events/last/{page}`                               | Storico partite del giocatore      |
| `search/all?q={query}`                                         | Ricerca globale                    |

### Caching e performance

- **Cache in-memory API** (`sofascore.ts`): tutte le risposte JSON sono cachate per 5 minuti con TTL
- **Retry con backoff esponenziale**: 3 tentativi (0ms, 1s, 2s) per ogni richiesta fallita
- **Cache a livello hook**: `usePlayerData` e `useMatchDetails` cachano i risultati per evitare refetch
- **Debounce ricerca**: 500ms sulla SearchBar
- **Paginazione lazy**: le partite si caricano a pagine con bottone "Carica altre"
- **Cleanup degli effect**: flag `cancelled` previene aggiornamenti di stato su componenti smontati

---

## Pagine e componenti

### Pagine

**HomePage** — Schermata di benvenuto. Mostra la barra di ricerca e un messaggio che invita a selezionare un paese dalla sidebar per iniziare la navigazione.

**PlayerPage** — Pagina principale di analisi. Composta da:
1. Header del giocatore (avatar, nome, squadra, ruolo, numero maglia)
2. Filtri (anno stagione, tornei, falli commessi/subiti)
3. Overview statistiche aggregate (griglia 3×2)
4. Lista partite con card espandibili

### Layout

**Sidebar** (210px, fissa a sinistra) — Mostra contenuti diversi in base al livello di navigazione corrente:
- Livello `home` / `leagues`: lista paesi
- Livello `teams`: lista campionati + lista squadre compatta
- Livello `team` / `player`: breadcrumb del contesto + lista squadre

**ContentPanel** — Contenitore principale che renderizza la vista corrente. Gestisce la split view su desktop dividendo lo spazio in due pannelli.

**SearchBar** — Input con debounce 500ms. I risultati appaiono in un dropdown con avatar, nome e squadra. Cliccando un risultato si naviga alla pagina del giocatore.

### Navigazione

**CountryList** — Lista di 6 bottoni con le bandiere dei paesi disponibili.

**LeagueList** — Mostra i campionati del paese selezionato (2 per paese, 4 per Europa).

**TeamGrid** — Griglia responsiva (2-4 colonne) delle squadre di un campionato, ottenute dalla classifica SofaScore. Ogni card mostra logo e nome.

**TeamView** — Vista completa della squadra:
- Rosa completa divisa per ruolo
- Se disponibile, formazione della prossima partita visualizzata su un campo SVG con i giocatori posizionati secondo il modulo tattico

**SidebarTeamList** — Lista compatta delle squadre mostrata nella sidebar quando si è dentro un campionato.

### Player

**PlayerHeader** — Avatar circolare, nome completo, squadra con logo, posizione e numero maglia.

**PlayerFilters** — Tre livelli di filtro:
1. **Anno stagione**: dropdown con gli anni disponibili
2. **Tornei**: toggle per includere/escludere singoli tornei (quando il giocatore gioca in più competizioni)
3. **Tipo fallo**: switch tra "Falli commessi" e "Falli subiti"

**StatsOverview** — Griglia 3×2 che mostra:
- Totale falli commessi/subiti
- Media falli per partita
- Media falli per 90 minuti
- Totale presenze
- Totale minuti giocati

I valori cambiano dinamicamente in base ai filtri attivi e al tipo di fallo selezionato.

**MatchList** — Lista paginata delle partite del giocatore. Le partite sono raggruppate per squadra (gestisce i trasferimenti). Ogni gruppo mostra il logo e nome della squadra. Un bottone "Carica altre" permette di caricare ulteriori pagine.

**MatchCard** — Card espandibile per ogni partita. In stato chiuso mostra: data, avversario, risultato, numero di falli. Espandendola si vedono:
- Lista dei singoli falli con minuto, tipo, avversario coinvolto e zona del campo
- Indicazione se il giocatore era titolare o subentrato (con minuti di ingresso/uscita)
- FieldMap con le posizioni medie dei giocatori

**FieldMap** — Visualizzazione SVG di un campo da calcio con le posizioni medie dei giocatori della partita. La squadra di casa occupa la metà superiore, quella ospite la metà inferiore. Il giocatore selezionato è evidenziato in verde neon. Ogni giocatore è rappresentato da un cerchio con il numero di maglia.

### Common

**Badge** — Componente di testo con 3 varianti: `default` (grigio), `neon` (verde), `negative` (rosso).

**PlayerDot** — Cerchio SVG usato nel FieldMap e nel TeamView per rappresentare la posizione di un giocatore sul campo, con numero di maglia centrato.

---

## Logica di business

### Calcolo statistiche

`statsCalculator.ts` aggrega le statistiche di più tornei/stagioni sommando falli commessi, falli subiti, minuti giocati e presenze. Calcola poi le medie per partita e per 90 minuti con divisione safe (ritorna `0.00` se il divisore è 0).

### Estrazione falli

`foulPairing.ts` analizza i commenti testuali delle partite (tipo cronaca) per estrarre i falli. La logica:

1. **Fallo commesso** (`freeKickLost`): il giocatore ha commesso un fallo. Si cerca il commento adiacente di tipo `freeKickWon` per identificare la vittima.
2. **Fallo subito** (`freeKickWon`): il giocatore ha subito un fallo. Si cerca il commento adiacente di tipo `freeKickLost` per identificare chi ha commesso il fallo.
3. **Fallo di mano** (`handball`): identificato dalla keyword "handball" nel testo, trattato come tipo separato.

Per ogni fallo viene estratto il minuto (da pattern `45'`) e la zona del campo, tradotta in italiano (es. "in the defensive half" → "nella propria metà campo").

La funzione `extractSubstitutionInfo` analizza gli stessi commenti per trovare i minuti di ingresso e uscita del giocatore per sostituzione.

### Mapping posizioni campo

`positionMapping.ts` gestisce due trasformazioni:

1. **Posizioni medie SofaScore → coordinate schermo**: le coordinate SofaScore hanno `avgX` (0=propria porta, 100=porta avversaria) e `avgY` (0=destra, 100=sinistra). Vengono convertite in pixel per il rendering SVG, con home team nella metà superiore e away team nella metà inferiore.

2. **Formazioni tattiche → coordinate**: contiene un dizionario di 13 moduli tattici (4-4-2, 4-3-3, 3-5-2, ecc.) con le coordinate percentuali di ogni posizione. Per formazioni non presenti nel dizionario, genera automaticamente una distribuzione uniforme basata sui numeri del modulo.

---

## Tema e stile

L'app usa un **tema dark** con accenti neon verdi, definito tramite variabili CSS in `index.css`:

| Variabile         | Colore    | Uso                        |
| ----------------- | --------- | -------------------------- |
| `--color-bg`      | `#0d0f11` | Sfondo principale          |
| `--color-sidebar` | `#11141a` | Sfondo sidebar             |
| `--color-surface` | `#151a22` | Card e superfici           |
| `--color-border`  | `#1e2530` | Bordi                      |
| `--color-neon`    | `#4ade80` | Colore primario (verde)    |
| `--color-negative`| `#E24B4A` | Colore negativo (rosso)    |
| `--color-text`    | `#e2e8f0` | Testo principale           |
| `--color-text-secondary` | `#94a3b8` | Testo secondario  |
| `--color-text-muted`     | `#475569` | Testo disattivato  |

Il layout è responsive con breakpoint a `md` (768px) e `lg` (1024px). La sidebar si nasconde su mobile. La split view si attiva solo da `lg` in su.
