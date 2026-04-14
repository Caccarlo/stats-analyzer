# Stats Analyzer: workflow pratico Figma <-> codice

## 1. Audit reale del repo

### Stack e punti di ingresso

- Client: React 19 + TypeScript + Vite + Tailwind CSS 4
- Server: Express proxy verso SofaScore
- Entry point client: `client/src/main.tsx`
- Root app: `client/src/App.tsx`
- Navigazione: nessun React Router; il sito usa uno state machine interno in `client/src/context/NavigationContext.tsx`
- View reali ricavate dal codice: `home`, `leagues`, `teams`, `team`, `player`

### Routing reale

Il sito non ha URL page-based. Le schermate sono guidate da `PanelState.view` e dal reducer di navigazione:

- `home`: calendario giornaliero con sidebar paesi
- `leagues`: lista tornei per paese
- `teams`: vista torneo con standings oppure fasi
- `team`: formazione, prossima partita, ultime/prossime, rosa completa
- `player`: filtri, overview statistiche, timeline, match cards

### Modalita di layout che contano come frame Figma distinti

- Single panel
- Split view desktop da `1024px` in su
- Mobile drawer per sidebar sotto `768px`
- Compact density quando `width < 640` oppure `height < 820`
- Varianti panel-aware in `TeamView` e `PlayerPage` basate sulla larghezza misurata del pannello

## 2. Inventory UI attuale

### Pagine e sezioni reali

| View | File | Sezioni reali |
|---|---|---|
| Home | `client/src/pages/HomePage.tsx` | top bar search, `CalendarStrip`, `DaySchedule`, accordion paesi, accordion tornei, `MatchRow` |
| Leagues | `client/src/components/navigation/LeagueList.tsx` | titolo paese, lista tornei cliccabili |
| Teams | `client/src/components/navigation/TeamGrid.tsx` | titolo torneo, select stagione, opzionale select fase, griglia squadre o standings cards, sezioni gruppo/fase |
| Team | `client/src/components/navigation/TeamView.tsx` | header squadra, prossima partita, pulsante split desktop, filtro competizione, tabs ultime/prossime, field formazione, blocco match list, rosa completa |
| Player | `client/src/pages/PlayerPage.tsx` | header giocatore, filtri, stats overview, timeline partite, griglia `MatchCard` |

### Componenti condivisi da preservare

| Area | Componenti |
|---|---|
| Layout | `Sidebar`, `ContentPanel`, `SearchBar` |
| Home | `HomeCalendar`, `CalendarStrip`, `DaySchedule`, `CountrySection`, `LeagueSection`, `MatchRow` |
| Navigation | `CountryList`, `LeagueList`, `TeamGrid`, `SidebarTeamList`, `TeamView` |
| Player | `PlayerHeader`, `PlayerFilters`, `StatsOverview`, `MatchTimeline`, `MatchCard`, `FieldMap`, `HeatmapField` |
| Common | `Badge`, `PlayerDot` |

### Varianti funzionali da rappresentare in Figma

- `teams` ha 2 sottotipi reali:
  - standings league
  - phase/cup view con select fase
- `team` ha 3 layout reali:
  - portrait-bottom
  - portrait-right
  - landscape-right
- `player` ha varianti reali:
  - single panel
  - split right panel
  - match card single/double/multi
- `home` ha varianti reali:
  - single panel con calendar strip in top bar
  - split right con sidebar paesi interna
  - mobile con hamburger drawer

## 3. Design system esistente da preservare

### Token gia presenti nel codice

Fonte: `client/src/index.css`

| Token | Valore |
|---|---|
| `--color-bg` | `#0d0f11` |
| `--color-bg-sidebar` | `#11141a` |
| `--color-surface` | `#151a22` |
| `--color-surface-hover` | `#1a1f25` |
| `--color-border` | `#1e2530` |
| `--color-neon` | `#4ade80` |
| `--color-negative` | `#E24B4A` |
| `--color-text-primary` | `#e0e0e0` |
| `--color-text-secondary` | `#8a96a6` |
| `--color-text-muted` | `#5a6a7a` |
| `--color-field-bg` | `#1a3320` |
| `--color-field-lines` | `#2a5535` |
| `--sidebar-width` | `204px` desktop, `172px` tablet |

### Convenzioni UI gia codificate

- Header desktop e sidebar header allineati a `h-14`
- Split view solo da `1024px`
- Mobile nav sotto `768px`
- Compact density sotto `640px` oppure `height < 820`
- Tipografia globale ancora `system-ui`, quindi non esiste un token typography formale
- Nessun Storybook, nessun `figma.config.json`, nessun file `.figma.*`

## 4. Matrice viewport da usare in Figma

Usare questi frame base, perche riflettono il codice:

| Viewport | Perche serve |
|---|---|
| `390x844` | mobile reale con hamburger e single-panel |
| `768x1024` | tablet reale con sidebar fissa ma senza split |
| `1024x768` | soglia split + compact desktop |
| `1440x900` | desktop standard |

Per `team` e `player` la larghezza del pannello conta piu del viewport intero. In Figma conviene prevedere anche frame panel-based:

- `team-panel-wide`
- `team-panel-medium`
- `team-panel-narrow`
- `player-panel-single`
- `player-panel-split-right`

## 5. Piano operativo per ricostruire lo stato attuale in Figma

### Step 0: congelare i contenuti di riferimento

Il dato live arriva da SofaScore, quindi il contenuto cambia. Prima di disegnare:

1. Scegliere una data di riferimento per `home`
2. Scegliere un torneo standings
3. Scegliere un torneo a fasi
4. Scegliere una squadra reale
5. Scegliere un giocatore reale

Durante questa analisi ho validato in UI, come esempi utili:

- `home` al `2026-04-14`
- `Serie B`
- `Catanzaro`
- `Pietro Iemmello`

### Step 1: creare il file Figma con questa struttura

- `00_Cover`
- `01_Foundations`
- `02_Components`
- `03_Screens_Current`
- `04_Redesign`
- `05_Handoff`

### Step 2: costruire prima foundations e componenti

In `01_Foundations`:

- Colors da `index.css`
- Grid/layout rules
- Border radius principali
- Elevation/shadows usate
- Sidebar widths e panel widths note
- Stati `default`, `hover`, `selected`, `loading`, `empty`, `error`

In `02_Components` creare almeno:

- SearchBar
- Sidebar item
- Back row
- Country accordion row
- League accordion row
- Match row
- Team card standings
- Team card plain
- Tabs ultime/prossime
- Competition chip
- Filter chip
- Stats card
- Timeline match pill
- Match card shell
- Team badge / player badge / card icon

### Step 3: ricostruire gli screen current-state

Frame minimi consigliati:

- `HOME_1440`
- `HOME_768`
- `HOME_390`
- `LEAGUES_768`
- `LEAGUES_390`
- `TEAMS_STANDINGS_1440`
- `TEAMS_PHASES_1440`
- `TEAM_1440`
- `TEAM_768`
- `TEAM_390`
- `PLAYER_1440_SINGLE`
- `PLAYER_1440_SPLIT_RIGHT`
- `PLAYER_768`
- `PLAYER_390`
- `SPLIT_TEAM_PLAYER_1440`

### Step 4: ordine corretto di ricostruzione

1. Layout shell: sidebar, top bar, content panel
2. Home
3. Leagues
4. Teams standings
5. Teams phases
6. Team
7. Player
8. Split layouts

### Step 5: naming da usare in Figma

- Frame: `VIEW__viewport__variant`
- Components: `Area/Component/Variant`
- Esempio: `Player/TimelineCard/Selected`
- Esempio: `Navigation/TeamCard/Standing`

## 6. Workflow realistico Figma -> codice per questo repo

### Cosa si puo automatizzare davvero

- Estrarre tokens base dai CSS custom properties
- Mappare le view reali partendo dal codice, non dagli screenshot
- Usare screenshot del sito come base di tracciamento per Figma
- Collegare componenti Figma a componenti codice tramite una mapping table manuale
- Implementare il redesign direttamente nei componenti React esistenti senza riscrivere il routing

### Cosa non si puo automatizzare in modo completo

- Sync 1:1 automatico Figma <-> DOM
- Round-trip completo da Figma al codice
- Ricostruzione automatica affidabile di Auto Layout, spacing logici e stati da HTML live
- Traduzione automatica delle varianti panel-aware di `TeamView` e `MatchCard`
- Preservare da sola tutta la logica dati e split view tramite semplice export da Figma

### Workflow semi-automatico consigliato

1. Audit del redesign in Figma per componenti, non per schermate isolate
2. Agganciare ogni change request a un componente codice esistente
3. Aggiornare prima i tokens globali
4. Aggiornare poi layout condivisi
5. Aggiornare poi componenti atomici/riusabili
6. Aggiornare infine le pagine composte
7. Validare a `390`, `768`, `1024`, `1440`

### Mapping raccomandato Figma -> codice

| Figma component | Codice da toccare |
|---|---|
| App shell | `Sidebar`, `ContentPanel`, `App.tsx` |
| Search | `SearchBar` |
| Home calendar | `HomePage`, `HomeCalendar`, `CalendarStrip`, `DaySchedule` |
| Country/tournament rows | `CountrySection`, `LeagueSection`, `MatchRow` |
| Tournament teams | `TeamGrid`, `SidebarTeamList` |
| Team screen | `TeamView` |
| Player header and filters | `PlayerHeader`, `PlayerFilters`, `PlayerPage` |
| Player stats/timeline/cards | `StatsOverview`, `MatchTimeline`, `MatchCard` |
| Pitch and heatmap | `FieldMap`, `HeatmapField` |

## 7. Come applicare il redesign approvato nel codice

### Ordine di implementazione consigliato

1. Tradurre il redesign in delta component-level
2. Aggiornare tokens e variabili globali
3. Aggiornare shell e layout condivisi
4. Aggiornare componenti riusabili
5. Aggiornare pagine composte
6. Rifinire panel-aware responsive logic
7. QA visivo e funzionale

### Checklist pratica per ogni redesign approvato

- Confermare quali frame Figma sono source of truth
- Congelare i viewport da validare
- Elencare i componenti coinvolti
- Separare change estetico da change strutturale
- Verificare impatto su split view
- Verificare impatto su mobile drawer
- Verificare loading, empty, error states
- Aggiornare documentazione di progetto solo dopo merge finale

### Regola importante per questo repo

Non conviene creare nuove pagine o un nuovo router per applicare il redesign. Il punto di attacco corretto e:

- `App.tsx` per shell e top bar
- `NavigationContext` per flussi di pannello
- componenti esistenti per il restyling

## 8. Ponte Figma/Codice: limiti concreti in questa sessione

### Limiti verificati

- Non esiste un file Figma gia connesso al repo
- Non esiste `figma.config.json`
- Non esistono template Code Connect `.figma.js` o `.figma.tsx`
- L'account Figma disponibile in sessione risulta su piano `starter` con seat `view`

### Impatto pratico

- Non posso creare ora un ponte Code Connect completo e operativo per il repo
- Non posso fare mapping MCP node-to-code senza un file Figma, node IDs e permessi adeguati
- Anche con il file Figma pronto, Code Connect parserless richiede componenti pubblicati e piano Organization/Enterprise

### Miglior workflow realistico

Oggi:

- mappa codice -> componenti
- ricostruzione current-state in Figma
- redesign in Figma
- handoff per componenti e viewport
- implementazione diretta in React/Tailwind

Quando avrete un file Figma definitivo e permessi adeguati:

1. aggiungere `figma.config.json`
2. pubblicare i componenti Figma di libreria
3. creare mapping Code Connect per i componenti piu stabili
4. usare Code Connect come supporto al handoff, non come sync totale

## 9. Output pratico consigliato da qui in avanti

### Deliverable 1

Un file Figma con:

- foundations
- component library
- current-state screens
- redesign screens
- handoff page con mapping ai file React

### Deliverable 2

Un documento di handoff per ogni redesign approvato con:

- frame Figma coinvolti
- viewport coinvolti
- componenti React da toccare
- priorita implementativa
- note su stati e responsive

### Deliverable 3

Implementazione a branch in quest'ordine:

- tokens
- shell
- shared components
- screens
- regression QA

