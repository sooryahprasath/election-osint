/**
 * Mobile UX audit driver.
 *
 * Runs Playwright Chromium at two canonical viewports (iPhone 14 Pro 390x844,
 * Android small 360x800) and captures every visible pane/mode/modal combination
 * to ui-audit/<bucket>/<viewport>-<scene>.png.
 *
 * Usage:
 *   npm run dev            # in another terminal (or reuse running server)
 *   node scripts/mobile-audit.mjs              # writes to ui-audit/before/
 *   AUDIT_BUCKET=after node scripts/mobile-audit.mjs
 *
 * Env:
 *   BASE_URL (default http://127.0.0.1:3000)
 *   AUDIT_BUCKET (default "before")   # subdir under ui-audit/
 *   AUDIT_ONLY (comma-separated scene ids to limit runs, optional)
 */

import { chromium, devices } from "playwright"
import { mkdir } from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000"
const BUCKET = (process.env.AUDIT_BUCKET || "before").trim()
const OUT_DIR = path.join(root, "ui-audit", BUCKET)
const ONLY = (process.env.AUDIT_ONLY || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

const VIEWPORTS = [
  { key: "iphone14pro", width: 390, height: 844, userAgent: devices["iPhone 14 Pro"]?.userAgent },
  { key: "android360", width: 360, height: 800, userAgent: devices["Pixel 5"]?.userAgent },
]

/** Click a button inside <main> by visible text substring. Ignores known false-match rows. */
async function clickMainButton(page, substring, { exact = false } = {}) {
  const clicked = await page.evaluate(
    ({ sub, ex }) => {
      const main = document.querySelector("main")
      if (!main) return false
      const buttons = Array.from(main.querySelectorAll("button"))
      const btn = buttons.find((b) => {
        const t = (b.textContent || "").replace(/\s+/g, " ").trim()
        if (t.includes("LIVE TURNOUT") || t.includes("EXIT POLLS")) return false
        return ex ? t === sub : t.includes(sub)
      })
      if (btn) {
        btn.click()
        return true
      }
      return false
    },
    { sub: substring, ex: exact }
  )
  await page.waitForTimeout(800)
  return clicked
}

/**
 * Click the mobile bottom-bar tab by accessible name.
 * Accepts either the legacy label (AI BRIEFING / CENTER / INTEL) or the new one
 * (Feed / Explore / Seats) so the script works before and after the rename.
 */
async function clickMobileTab(page, label) {
  const ALIASES = {
    "AI BRIEFING": ["AI BRIEFING", "Feed"],
    CENTER: ["CENTER", "Explore"],
    INTEL: ["INTEL", "Seats"],
    Feed: ["Feed", "AI BRIEFING"],
    Explore: ["Explore", "CENTER"],
    Seats: ["Seats", "INTEL"],
  }
  const tries = ALIASES[label] || [label]
  const bar = page.locator("nav[aria-label='Primary'], div.md\\:hidden.fixed.bottom-0").first()
  for (const name of tries) {
    const btn = bar.getByRole("button", { name, exact: true })
    if ((await btn.count()) > 0) {
      await btn.first().click()
      await page.waitForTimeout(900)
      return true
    }
  }
  return false
}

/** Screenshot helper. */
async function shot(page, viewport, scene) {
  if (ONLY.length && !ONLY.includes(scene)) return
  const safe = scene.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()
  const file = path.join(OUT_DIR, `${viewport.key}-${safe}.png`)
  await page.screenshot({ path: file, fullPage: true })
  console.log("  wrote", path.relative(root, file))
}

/** Navigate to a fresh session (resets global state between scenes). */
async function freshLoad(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("main", { state: "visible", timeout: 60_000 })
  await page.waitForTimeout(1400)
}

async function runViewport(context, viewport) {
  console.log(`\n== viewport ${viewport.key} (${viewport.width}x${viewport.height}) ==`)
  const page = await context.newPage()
  page.setDefaultTimeout(90_000)
  await page.setViewportSize({ width: viewport.width, height: viewport.height })

  await freshLoad(page)
  await shot(page, viewport, "01_initial_load")

  // Mobile bottom tabs
  await clickMobileTab(page, "AI BRIEFING")
  await shot(page, viewport, "02_tab_briefing")

  await clickMobileTab(page, "CENTER")
  await shot(page, viewport, "03_tab_center_default")

  // Center modes. Buttons are uppercase pills.
  const centerModes = [
    { label: "INSIGHTS", slug: "insights" },
    { label: "MAP", slug: "map" },
    { label: "SIGNALS", slug: "signals" },
    { label: "VIDEOS", slug: "videos" },
    { label: "POLLS", slug: "polls" },
  ]
  for (const m of centerModes) {
    const ok = await clickMainButton(page, m.label)
    if (ok) await shot(page, viewport, `04_center_${m.slug}`)
  }

  // Live center chip (variant names)
  for (const live of ["VOTING LIVE", "COUNTING LIVE", "LIVE"]) {
    const ok = await clickMainButton(page, live)
    if (ok) {
      await shot(page, viewport, `04_center_live_${live.replace(/\s+/g, "_").toLowerCase()}`)
      break
    }
  }

  // Intel tab (seat list)
  await clickMobileTab(page, "INTEL")
  await shot(page, viewport, "05_tab_intel_national")

  // Select a state chip if present (prefer TN or KL for reliable data).
  for (const state of ["TN", "KL", "WB", "PY"]) {
    const picked = await page.evaluate((s) => {
      const buttons = Array.from(document.querySelectorAll("button"))
      const btn = buttons.find((b) => (b.textContent || "").trim() === s)
      if (btn) {
        btn.click()
        return true
      }
      return false
    }, state)
    if (picked) {
      await page.waitForTimeout(900)
      await shot(page, viewport, `06_intel_state_${state.toLowerCase()}`)
      break
    }
  }

  // Back to Center → Insights with state selected
  await clickMobileTab(page, "CENTER")
  await clickMainButton(page, "INSIGHTS")
  await shot(page, viewport, "07_insights_state_selected")

  // Try to drill into the first seat row in Intel
  await clickMobileTab(page, "INTEL")
  await page.evaluate(() => {
    const scopes = Array.from(document.querySelectorAll("button, a"))
    const seat = scopes.find((el) => /^[A-Z]{2,3}-\d{2,4}/.test((el.textContent || "").trim()))
    if (seat) seat.click()
  })
  await page.waitForTimeout(900)
  await shot(page, viewport, "08_intel_seat_selected")

  // Insights with seat selected
  await clickMobileTab(page, "CENTER")
  await clickMainButton(page, "INSIGHTS")
  await shot(page, viewport, "09_insights_seat_selected")

  // Try to open a candidate dossier from Intel
  await clickMobileTab(page, "INTEL")
  const opened = await page.evaluate(() => {
    // Candidate names render as clickable buttons with an avatar next to them in the list.
    const buttons = Array.from(document.querySelectorAll("button"))
    const cand = buttons.find((b) => {
      const t = (b.textContent || "").trim()
      return t.length > 4 && t.length < 60 && /[A-Z][a-z]+/.test(t) && !/^[A-Z]{2,3}-\d/.test(t)
    })
    if (cand) {
      cand.click()
      return true
    }
    return false
  })
  if (opened) {
    await page.waitForTimeout(1200)
    await shot(page, viewport, "10_candidate_dossier")
  }

  // Walkthrough (if any "Take tour / Walkthrough" button exists)
  await freshLoad(page)
  const wOpened = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"))
    const btn = buttons.find((b) => /walkthrough|take tour|getting started/i.test(b.textContent || ""))
    if (btn) {
      btn.click()
      return true
    }
    return false
  })
  if (wOpened) {
    await page.waitForTimeout(800)
    await shot(page, viewport, "11_walkthrough_modal")
  }

  await page.close()
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        userAgent: viewport.userAgent,
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      })
      await runViewport(context, viewport)
      await context.close()
    }
  } finally {
    await browser.close()
  }
  console.log(`\nDone. Screenshots in ${path.relative(root, OUT_DIR)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
