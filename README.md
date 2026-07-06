# tunebook-sets

Web app companion to [tunebook-flashcards](../tunebook-flashcards): browse your
thesession.org tunebook as on-screen flashcards (same key/meter edge bands) and
build sets with key-aware suggestions.

## Run
    npm install
    npm start          # http://localhost:3117

## Deploy (container)
Every push to `main` builds and publishes an image via GitHub Actions:

    docker run -d -p 3117:3117 -v tunebook-cache:/app/.cache \
      ghcr.io/davidiam/tunebook-sets:latest

The volume keeps the polite thesession.org response cache across restarts
(optional — it rebuilds on demand). Tags: `latest` (main), `sha-…` per
commit, and semver tags on `v*` releases.

Reuses `../tunebook-flashcards/.cache` when present, so tunes already fetched
for the PDF generator load instantly. Override with `CACHE_DIR=... npm start`.

## Politeness & local-first architecture
- Every request to thesession.org flows through one global queue
  (sequential, ≥300 ms between network hits); disk-cache hits bypass it.
- Long fetches report realtime progress ("fetching tunes 137/213") over
  SSE (`/api/progress/:jobId`), shown as a live counter + progress bar.
- The browser is the primary store: tunebook, analysis results, the Whelan
  corpus, full-tune ABC, and saved sets all live in localStorage. After the
  first load, filtering, suggestions, and set building run entirely locally;
  cached views show a "↻ refresh" affordance to re-fetch on demand.
  (Legacy `data/mysets.json` sets are imported into localStorage once.)

## Views
- **Cards** — the tunebook as flashcard tiles: key-signature band on top
  (modal cousins share a color), meter band on the right, first bars engraved
  with abcjs, first/last note of each tune shown.
- **Set builder** — add a starting tune, then pick from suggestions:
  - **Cousin keys**: same key signature, different key (D maj ↔ E dor …).
  - **Step transition**: candidate's first note is one diatonic step above or
    below the current tune's tonic (Em → next tune starts on F# or D).
  - **Voice-leading**: candidate's first note connects to the current tune's
    actual final note — same pitch, up a 5th, or up a step (the three most
    common last→first intervals in the analyzed sets), ranked in that order.
  - **Style match**: ranks candidates by patterns learned from analyzing the
    member's existing sets (see below).
  - **Heuristic suggestions**: seeded by the first tune of the current set,
    proposes six complete 3-tune sets that follow the analyzed style — same
    rhythm throughout, each transition one signature step on the circle of
    fifths, arching home to the opener's key (or its signature), ranked by
    voice-leading smoothness at both seams. Two recipes: **Whelan** (strict
    ±1 step every seam, arch built in, never repeats a key — his measured
    style) and **Conventional** (calibrated on four unrelated prolific
    members: seams may be steps, cousins, or same-key, weighted by observed
    frequency; arch is a bonus, not a rule). A seed-position modifier picks
    where the seed may sit: **contains** (any slot — often finds better sets;
    a tune that starts on D is a great closer), **starts with**, **ends with**.
    The seed is bolded/outlined in the proposals. Two views: a compact list, or
    six columns of stacked tune cards; each proposal has a "show music"
    button that overlays the full notation of all three tunes in their
    set-appropriate keys, ready to scroll and play. Each tune in the overlay
    has an abcjs synth player (play/restart/progress); the soundfont streams
    from the network on first play.
  Sets are saved to `data/mysets.json` (thesession.org has no write API).
- **Whelan sets** — browses the parsed corpus of John Whelan's emailed set
  lists (`data/whelan-sets.json`, deduped with play counts and date ranges);
  search by tune, load any set into the builder, or open its full notation.
- **Set analysis** — runs the transition analysis on any member's public sets.

## Findings from skylos's 619 sets (1012 tune transitions)

- **±1 key signature is the norm**: 62.7% of consecutive-tune transitions move
  exactly one accidental (G↔D, D↔A dor …). Modal cousins are 14.9%, same key
  16.7% — and staying in the same key is *less* likely than chance
  (lift ≈ 0.6), so variety is clearly deliberate.
- Δsignature is symmetric: +1 / −1 / 0 each ≈ 31%.
- **G↔D dominates** even after correcting for base rates (G→D lift 1.47,
  D→G 1.31); D→Emin (1.41), Dmix→Dmaj (1.37), G→Edor (1.30) are also favored.
- **Arch shape**: 37.5% of 3+-tune sets end in the key they began; among
  3-tune sets ABA (105) rivals ABC (131) and far exceeds chance.
- Tunes end on their tonic 58.8% of the time; they start on the tonic (34%)
  or the fifth (32%).
- The next tune's first note relative to the previous tonic: the 5th (20%),
  unison (18%), one step up (15%), 6th (13%), 4th (13%). "One step up or
  down" (the step-transition idea) covers ≈ 26% of real transitions.
- Voice-leading last note → first note: same pitch is the single most common
  connection, then up a fifth, then up a whole step.
- 92% of transitions keep the same tune type (reel→reel, jig→jig).

These weights power the **Style match** mode in the set builder.
