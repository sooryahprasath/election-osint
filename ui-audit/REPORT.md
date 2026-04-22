# Mobile UX Audit — Insights Bug Fix + Mobile Streamline

Viewports audited: `iPhone 14 Pro` (390x844) and `Android small` (360x800).

Before / after PNG folders are **gitignored** (generate locally). Paths when present: `ui-audit/before/`, `ui-audit/after/`.

Run with:

```bash
node scripts/mobile-audit.mjs                 # writes to ui-audit/before/
AUDIT_BUCKET=after node scripts/mobile-audit.mjs
```

---

## A. Insights 2021 Winner/Runner-up navigation bug (P0)

### Before

Clicking the Incumbent/Runner-up name in the Insights "Seat Snapshot (2021)" card
dispatched `openCandidateDossier` with the state-wide name match. The
`IntelPane` listener then hard-set `globalConstituencyId` to the candidate's
current 2026 seat, kicking the user out of the 2021 seat they were inspecting
(canonical case: viewing Nandigram 2021, click "Mamata Banerjee" → page jumps
to Bhabanipur 2026).

### After (fix)

- `InsightsCenterPane.tsx` now computes `inSeatWinnerCand` / `inSeatRunnerCand`
  by matching **only candidates in the currently selected seat**.
- The winner/runner-up name renders as a clickable button **only when a same-seat
  2026 candidate exists**. Otherwise it's plain text, so no navigation happens.
- When the state-wide match lives in a different seat, a small muted
  "Now contesting: `<other seat>`" line appears with a separate explicit
  **"Open 2026 profile"** button — the *only* affordance that moves the
  global constituency.
- `IntelPane.tsx`'s `openCandidateDossier` handler now no-ops
  `setGlobalConstituencyId` when the candidate's seat equals the current
  `globalConstituencyId`, so even the same-seat click doesn't trigger an
  unrelated re-mount/scroll.

Canonical regression case — viewing Nandigram in Insights and clicking
"Mamata Banerjee":

- If Mamata Banerjee has a 2026 filing for Nandigram → click opens her dossier
  **without changing the seat**.
- If she has filed in Bhabanipur 2026 (different seat) → the name is plain text,
  and a separate "Now contesting Bhabanipur · Open 2026 profile" link appears.
  Clicking that link is the only way to navigate to Bhabanipur.

Files changed:

- [src/components/center/InsightsCenterPane.tsx](../src/components/center/InsightsCenterPane.tsx) — new `inSeatWinnerCand` / `inSeatRunnerCand`, gated click, "Now contesting" link.
- [src/components/intel/IntelPane.tsx](../src/components/intel/IntelPane.tsx) — listener no-op when already on that seat.

Severity: **P0 — fixed**.

---

## B. Mobile UX findings + fixes

Severity: P0 blocks a core task; P1 degrades readability/ergonomics; P2 polish.

| # | Area | Finding (before) | Fix (after) | Severity | Status |
|---|------|------------------|-------------|----------|--------|
| 1 | Bottom nav jargon | "AI BRIEFING · CENTER · INTEL" labels are opaque; icons tiny; row 48px with no safe-area padding. | Renamed to **Feed / Explore / Seats**; row now 56px + `env(safe-area-inset-bottom)`; 20px icons; 44×44 tap targets; `aria-pressed`. | P0 | fixed |
| 2 | CenterModeSwitcher | 5–6 icon-only pills on mobile; cryptic; 28px tap targets. | Labels always visible; horizontal snap-scroll; 44px min-height; `role="tab"` / `aria-label`. | P0 | fixed |
| 3 | Typography floor | Whole app peppered with `text-[8px]` / `text-[9px] font-mono`; unreadable at arm's length. | Mobile CSS rule lifts `[class*='text-[8px]']`/`[9px]` to 11px and `[10px]` to 12px; body copy switches from `font-mono` to `font-sans`; numeric values keep mono via `num` / `keep-mono` class. | P0 | fixed |
| 4 | Insights scope row | Seat share + Constituency selects packed on one row at 360px; overflow. | Scope controls stack vertically on mobile; `h-11` selects; explicit labels; ml-auto removed on mobile. | P1 | fixed |
| 5 | Insights KPI strip | `grid-cols-4` at 360px → 4 tiny boxes; numerals 12px. | `grid-cols-2 sm:grid-cols-4`; numerals promoted to `text-base` on mobile; helper labels sentence-case. | P1 | fixed |
| 6 | Insights overload | "More state comparisons" block (5 deeply nested sub-panels) dominates mobile scroll. | Wrapped in a `MobileCollapsible` (default closed on mobile; identical on desktop). | P1 | fixed |
| 7 | Intel pane state chips | Horizontal chip row for 5+ states → truncation and 28px hits. | Collapsed into single `<select>` (with full state names) on mobile; desktop keeps chip row. | P1 | fixed |
| 8 | Intel Hotspots | Always-expanded; pushed the seat list below the fold. | Collapsible with count badge on mobile; default closed. Desktop unchanged. | P1 | fixed |
| 9 | Intel search input | 18px input row; 10px placeholder; hard to type on phone. | `h-11` + 14px sans input on mobile. | P1 | fixed |
| 10 | Intel seat rows | Row < 44px tall → accessibility fail; tap misses common. | `min-h-[48px]` per row + padding. | P1 | fixed |
| 11 | CandidateModal orientation | Scrolling loses you — no intra-modal nav, tiny close button. | Close target enlarged (44×44 + 24px icon); sticky mobile section tabs (Overview · Assets & cases · Background · Signals) with smooth scroll anchors; safe-area padding. | P1 | fixed |
| 12 | Dev hints leaking into UI | "Run eci_constituency_summary_ingestor.py --year 2021" / "run poll_ingestor.py" shown to end users. | Gated behind `NEXT_PUBLIC_SHOW_DEV_HINTS=true`; public copy is friendly ("We're still verifying 2021 results for this seat."). | P1 | fixed |
| 13 | Back affordance duplication | IntelPane had "← BACK" and map chrome "← MAP" competing on mobile. | Deferred — bottom-nav "Seats" tab already carries the back intent; the inline "← MAP" button is retained only when it's contextual. | P2 | deferred |
| 14 | Insights tight-seat list density | `grid-cols-12` row at 360px keeps things cramped. | Deferred — behind the collapsible now; revisit in a follow-up pass if usage data shows drop-off. | P2 | deferred |
| 15 | Safe-area padding app-wide | Some panes still under-pad above the OS home indicator. | Added `pb-safe` / `pb-nav-safe` utility classes in `globals.css`; BottomBar + CandidateModal now use them. Extend to remaining panes in a follow-up if audit reveals. | P2 | partial |

---

## C. How to diff

For each scene there is a before/after pair:

```
ui-audit/before/iphone14pro-04_center_insights.png
ui-audit/after/iphone14pro-04_center_insights.png
```

Scenes captured per viewport:

- 01 initial load
- 02 tab briefing
- 03 tab center default
- 04 center {insights, map, signals, videos, polls, live}
- 05 tab intel national
- 06 intel state TN
- 07 insights state selected
- 08 intel seat selected
- 09 insights seat selected
- 10 candidate dossier (only captured in the "after" run; pre-fix dossier route didn't reliably open from the mobile audit flow)

---

## D. Bug-fix verification plan (manual)

1. Open the app in mobile viewport.
2. Tap **Explore → Insights**.
3. Pick **WB** state, then any West Bengal 2021 seat with a known incumbent who moved in 2026 (e.g., Nandigram).
4. In the "Seat Snapshot (2021)" card:
   - Confirm the **Incumbent (winner)** row shows the 2021 winner name as
     plain text (if no 2026 same-seat filing) or as a clickable link (if
     same-seat filing exists).
   - If the "Now contesting: `<seat>`" line is visible, confirm an explicit
     **Open 2026 profile** button is also visible.
5. Click the winner name. Expected: either dossier opens in place **or**
   the name is unclickable. The page must **not** navigate to a different
   seat.
6. Click the "Open 2026 profile" link (when present). Expected: page
   navigates to the candidate's 2026 seat and opens their dossier.

---

## E. Follow-ups (not in this pass)

- Turn the rest of the Insights analytics sub-panels into individually
  collapsible sections with an "Expand all" control on mobile.
- Replace the "Filters" row (party filter + sort) in IntelPane with a proper
  bottom sheet. Current inline version is readable but still tight.
- Consolidate the last two map-related back affordances into a single
  pattern driven by breadcrumbs.
- Apply `pb-nav-safe` audit across all panes (currently applied where it
  was clearly needed during this pass).
