# Dharma-OSINT UI Design Review (Web + Mobile)

Scope: **UI/UX only** (information architecture, visual design, interaction design, accessibility, responsive/mobile ergonomics).  
Code references in this doc point to the current implementation so changes can be made surgically.

Last reviewed: 2026-04-08  
Reviewer lens: “war-room dashboard” (dense, glanceable, fast triage, low-error interaction).

---

## 1) Current UI at a glance

### Overall layout model
- **Top ticker/header**: `src/components/TopBar.tsx`
- **Three-column shell (desktop)**:
  - **Left**: “AI Briefing” + “Video Intel” strip, with state-scoped signal list when Center is Map/Videos: `src/components/signals/SignalPane.tsx`
  - **Center**: Mode switcher (Live/Signals/Videos/Map) + active center pane: `src/components/center/*`, driven by `src/app/page.tsx`
  - **Right**: Intel (states, hotspots, constituencies, candidates): `src/components/intel/IntelPane.tsx`
- **Mobile**: bottom tab bar with 3 destinations (Briefing / Center / Intel) in `src/app/page.tsx`. Center modes remain (Live/Signals/Videos/Map) via `CenterModeSwitcher`.

### Visual language
- Tokenized “tactical design system” with CSS variables (light + dark): `src/app/globals.css`
- Dense typography leans **mono** for labels and data; Inter for body.
- Color accents:
  - Neon green `#16a34a` (signals/OK)
  - Sky `#0284c7` (map/info/turnout)
  - Orange `#ea580c` (warning/exit polls)
  - Red `#dc2626` (danger/live)

---

## 2) Scorecard (current UX)

Scored 1–10 (10 = excellent for this product category).

### Web (desktop)
- **Information architecture**: **7.5/10**  
  Strong tri-pane mental model; CenterModeSwitcher is clear. Some duplication (signals in left vs center) adds cognitive overhead.
- **Visual hierarchy / glanceability**: **7/10**  
  Labels are consistent; severity cues work. A few contrast issues and overuse of similarly-styled pills/rows flatten hierarchy.
- **Interaction efficiency**: **7/10**  
  Many single-click drills (signals → modal, intel → seat → candidates). Missing quick search in Signals Center reduces triage speed.
- **Accessibility (contrast, targets, keyboard)**: **6/10**  
  Several elements are borderline in light theme; some interactive regions are small/dense. Focus styles exist in TopBar ticker but are inconsistent elsewhere.
- **Consistency / component reuse**: **7/10**  
  Videos has search + filters; Signals does not. Candidate photo exists in modal but not in lists. “LIVE” label mismatch with VOTING/COUNTING context.

### Mobile
- **Navigation**: **7/10**  
  Three bottom tabs are good. Center mode switcher is usable but can feel “nested.”
- **Touch ergonomics**: **6.5/10**  
  Many controls are compact (9–10px labels). Overscroll behaviors are intentionally constrained (good for map), but list panes lack “refresh” affordances.
- **Readability**: **6.5/10**  
  Dense text works for power users but needs stronger type scale and contrast in key banners.

---

## 3) Key issues observed (with direct fixes)

### A) Voting/Counting Live labeling does not match operational context
**Current**
- Center mode label is **LIVE**: `src/components/center/CenterModeSwitcher.tsx` (`MODE_META.live.label = "LIVE"`)
- In `src/app/page.tsx`, the live sub-tabs show **LIVE TURNOUT** and **EXIT POLLS** (good), but the outer “LIVE” doesn’t communicate whether this is *voting* or *counting*.

**UI recommendation**
- Rename Center mode from:
  - **LIVE → VOTING LIVE** when `operationMode === "VOTING_DAY"`
  - **LIVE → COUNTING LIVE** when `operationMode === "COUNTING_DAY"`
  - (Optional) keep **LIVE** in other non-pre-poll operational modes if introduced later.

**Why**
- Reduces ambiguity, especially when sharing screenshots or switching modes quickly.

---

### B) Voting turnout phase banner contrast is broken in light theme
**Current**
- Turnout phase banner uses `"bg-sky-500/10 text-sky-200"` etc in `src/components/warroom/VotingHud.tsx`.
- In light mode, `text-sky-200` is extremely low contrast on a pale sky background (matches the screenshot symptom: “blue bg and blue text not visible”).

**UI recommendation**
- Use **semantic tokens** instead of Tailwind palette shades for this banner so it works in light and dark:
  - Light: dark text on tinted background (e.g., `text-[#075985]` on `bg-[#0284c7]/10`)
  - Dark: light text on tinted background (current `text-sky-200` style is fine in dark).
- Alternatively: set banner text to `text-[var(--text-primary)]` and rely on border + icon color for tone.

**Why**
- This banner is a “system status” message. If it’s unreadable, the panel fails its primary job: explaining what the numbers mean and when they update.

---

### C) Signals Center lacks search (Videos has it)
**Current**
- Videos Center includes search + verified toggle: `src/components/center/VideosCenterPane.tsx` (`q`, `verifiedOnly`).
- Signals Center has filters by state + timeline but **no free-text search**: `src/components/center/SignalsCenterPane.tsx`.

**UI recommendation**
- Add a search input to Signals Center header, aligned with existing patterns:
  - Placeholder: “Search signals…”  
  - Scope: title + body + source (+ optional state/constituency IDs).
  - Add quick “clear” affordance (like Intel search uses `X`).
- Add a compact toggle row (chips) for:
  - **Verified only**
  - **Severity ≥ 4**
  - **Has geo / constituency**
  - **Has video**

**Why**
- Signals is the highest-volume surface. Without search, triage becomes scroll-heavy and slow.

---

### D) “Irrelevant news” needs a UI-level safety net (even if ingestion improves)
Your note: some items mention unrelated global news (e.g., Trump) then pivot into elections; you want to drop those.

**UI-only guidance (without changing ingestion logic yet)**
- Provide a **client-side “Relevance” affordance** in Signal cards and/or Signal modal:
  - **Badge**: `ELECTION-RELEVANT` / `LOW RELEVANCE`
  - **Action**: “Hide” (local-only) or “Mark irrelevant” (if later wired to a moderation table)
- Add a **Signals filter**: “Hide low-relevance”

**Why**
- OSINT pipelines will always leak noise. UI needs a “triage control” so analysts can keep flow clean in the moment.

---

### E) Candidate list needs photo thumbnails (Intel seat view + candidate rows)
**Current**
- Candidate photo exists and is displayed in the modal: `src/components/intel/CandidateModal.tsx` (`candidate.photo_url`).
- Candidate list row lacks a thumbnail: `src/components/intel/CandidateRow.tsx` shows party dot + name + stats only.

**UI recommendation (thumbnail integration)**
- Add a **24–32px** circular/squircle thumbnail at the start of `CandidateRow`:
  - Source: `candidate.photo_url`
  - Fallback: monogram/`User` icon (already used in modal)
  - Keep the party color dot (can become a small border ring or corner pip to avoid redundant indicators)
- Keep typography but improve hierarchy:
  - Line 1: candidate name (truncate)
  - Line 2: party chip + key risk chips (criminal cases, assets)
  - Thumbnail makes scanning lists significantly faster.

**Why**
- Visual recognition helps analysts and journalists. It also improves perceived quality and “dossier” credibility.

---

### F) Mobile pull-to-refresh (Signals + Videos)
**Current**
- Several panes use `overscroll-contain` / `touch-pan-y` to prevent bounce; good for map stability, but it removes the “native refresh” affordance in list surfaces.

**UI recommendation**
- For **Signals** and **Videos** panes on mobile:
  - Add pull-to-refresh gesture (or a top “Refresh” row) that triggers:
    - a lightweight “refetch” (if data is realtime-subbed, this can just re-run the initial query and show a toast “Synced”)
  - Provide visible feedback: a slim progress bar or spinner at the top.

**Why**
- Users expect it. It reduces “is it stuck?” anxiety, especially when realtime is delayed or the app resumes from background.

---

## 4) Screenshot-based observations (Voting view)
From the provided screenshot of the Voting Live surface:
- **Strengths**
  - The “cards per state” layout is understandable.
  - “Field notes & sources” is the right concept for trust.
  - Overall density fits a war-room.
- **Issues**
  - The **phase banner** is hard to read in light theme (contrast issue described above).
  - The turnout range **0–0** reads like a bug. UI should explicitly label as “Unknown yet” when min/max are zero.
  - The “LIVE” naming is ambiguous relative to voting vs counting.

---

## 5) UI improvements prioritized (impact × effort)

### P0 (do first; high impact, low risk)
- **Fix phase banner contrast** in `VotingHud`.
- **Rename Live → Voting Live / Counting Live** (mode label and/or header).
- **Signals Center search bar** (match Videos pattern).
- **Turnout unknown-state UI**: when `turnout_min == 0 && turnout_max == 0`, show:
  - Primary: “Awaiting estimate”
  - Secondary: “No numeric turnout detected yet”

### P1 (next; improves usability and trust)
- **CandidateRow thumbnails** (fast scan + perceived quality).
- **Signals quick filters** (Verified/severity/geo/video).
- **Relevance safety net** (badge + hide/mark irrelevant in UI).

### P2 (mobile polish)
- **Pull-to-refresh** for Signals + Videos surfaces.
- Increase minimum tap target sizes in mobile for dense pills (keep mono style but raise padding and/or clamp text sizes).

---

## 6) Concrete UI design specs (so implementation stays consistent)

### Search fields (Signals + Videos + Intel)
- Container: `rounded-md border border-[color:var(--border)] bg-[var(--surface-1)]`
- Text: `font-mono text-[10px]` (mobile can bump to 11px)
- Icon left, “clear” affordance right when query non-empty.
- Keyboard:
  - `Esc` clears query (optional but recommended)
  - `Enter` does nothing (filter updates live)

### Badges and tones (reuse across app)
- **Verified**: `emerald` tone (already used in Videos)
- **Unverified**: `orange` tone
- **Low relevance**: `zinc` tone (quiet)
- **High severity**: `red` tone

### Voting turnout cards
- Replace `—` with explicit “Awaiting estimate” state.
- Keep range typography, but cap huge font sizes on small screens to avoid truncation.

---

## 7) Notes on consistency with existing code
- `VideosCenterPane` already implements a good search/filter pattern. Reuse it for `SignalsCenterPane`.
- `CandidateModal` already has photo fallback UI. Reuse the same fallback in `CandidateRow`.
- The CSS variables in `globals.css` are a good foundation; status banners should lean on tokens to avoid light/dark contrast regressions.

---

## 8) Next deliverable (if you want implementation)
If you want me to implement the UI changes from this doc, I’d start with:
- Voting banner contrast + “Voting Live / Counting Live” naming
- Signals search bar + quick filters
- CandidateRow thumbnail integration
- Mobile pull-to-refresh behavior

