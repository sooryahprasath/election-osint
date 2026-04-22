/**
 * UX Audit — headed Playwright, localhost:3000
 * Comprehensive: every tab, deep Insights, candidate dossier, light + dark, all form-factors
 */
import { chromium, devices } from "playwright"
import { mkdir } from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { createHash } from "crypto"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root      = path.join(__dirname, "..")
const BASE_URL  = "http://localhost:3000"
const BUCKET    = (process.env.AUDIT_BUCKET || "v6").trim()
const THEME     = (process.env.AUDIT_THEME  || "light").trim()
const OUT_DIR   = path.join(root, "ui-review", BUCKET)

const PROFILES = {
  desktop: { w: 1440, h: 900,  mobile: false, touch: false },
  tablet:  { w: 820,  h: 1180, mobile: false, touch: true,  ua: devices["iPad (gen 7)"]?.userAgent },
  iphone:  { w: 390,  h: 844,  mobile: true,  touch: true,  ua: devices["iPhone 14 Pro"]?.userAgent },
  android: { w: 360,  h: 800,  mobile: true,  touch: true,  ua: devices["Pixel 5"]?.userAgent },
}

const WANTED = (process.env.AUDIT_PROFILES || "desktop,tablet,iphone,android")
  .split(",").map(s => s.trim()).filter(k => PROFILES[k])

const TAB_VIEW = { Insights:"insights", Map:"map", News:"news", Videos:"videos", Polls:"polls" }

// ── helpers ───────────────────────────────────────────────────────────────────
let seq = 0
const lastHash = new WeakMap()

function md5(buf) { return createHash("md5").update(buf).digest("hex") }

async function snap(page, key, label) {
  seq++
  const n    = String(seq).padStart(2,"0")
  const safe = label.replace(/[^a-z0-9]+/gi,"_").toLowerCase()
  const file = path.join(OUT_DIR, `${key}-${THEME}-${n}_${safe}.png`)
  const buf  = await page.screenshot({ path: file, fullPage: false, timeout: 60_000 })
  const h    = md5(buf)
  const dup  = lastHash.get(page) === h ? " ⚠ dup" : ""
  lastHash.set(page, h)
  console.log(`  ${path.relative(root, file)}${dup}`)
}

async function snapFull(page, key, label) {
  seq++
  const n    = String(seq).padStart(2,"0")
  const safe = label.replace(/[^a-z0-9]+/gi,"_").toLowerCase()
  const file = path.join(OUT_DIR, `${key}-${THEME}-${n}_${safe}_full.png`)
  const buf  = await page.screenshot({ path: file, fullPage: true, timeout: 60_000 })
  const h    = md5(buf)
  const dup  = lastHash.get(page) === h ? " ⚠ dup" : ""
  lastHash.set(page, h)
  console.log(`  ${path.relative(root, file)}${dup}`)
}

async function load(page) {
  await page.addInitScript((t) => {
    try { localStorage.setItem("theme", t) } catch {}
    document.documentElement.classList.toggle("dark", t === "dark")
  }, THEME)
  await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 60_000 })
  await page.waitForSelector("main", { timeout: 30_000 })
  await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), THEME)
  await page.waitForTimeout(2500)
}

async function gotoTab(page, label) {
  const view = TAB_VIEW[label]
  const ok = await page.evaluate((lbl) => {
    const btn = [...document.querySelectorAll('[role="tab"]')]
      .find(b => (b.textContent||"").trim().toLowerCase() === lbl.toLowerCase())
    if (!btn) return false
    btn.dispatchEvent(new MouseEvent("click", { bubbles:true, cancelable:true, view:window }))
    return true
  }, label)
  if (!ok) { console.warn(`  ⚠ tab "${label}" not found`); return false }
  try {
    await page.waitForSelector(`[data-view="${view}"]`, { timeout: 15_000 })
  } catch {
    const got = await page.evaluate(() =>
      [...document.querySelectorAll("[data-view]")].map(e => e.dataset.view))
    console.warn(`  ⚠ [data-view="${view}"] missing — got: ${JSON.stringify(got)}`)
    return false
  }
  await page.waitForTimeout(700)
  return true
}

async function navTo(page, ariaLabel) {
  await page.evaluate((lbl) => {
    const btn = document.querySelector(`nav[aria-label="Primary"] button[aria-label="${lbl}"]`)
    if (btn) btn.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}))
  }, ariaLabel)
  await page.waitForTimeout(900)
}

async function pickState(page, code) {
  const ok = await page.evaluate((c) => {
    for (const sel of document.querySelectorAll("select")) {
      if (!sel.offsetParent) continue
      const opt = [...sel.options].find(o =>
        o.value===c || o.text.trim()===c ||
        o.text.startsWith(c+" ") || o.text.startsWith(c+" ·"))
      if (opt) {
        sel.value = opt.value
        sel.dispatchEvent(new Event("change",{bubbles:true}))
        return true
      }
    }
    for (const btn of document.querySelectorAll(".eb-pills button")) {
      if (btn.offsetParent && (btn.textContent||"").trim()===c) {
        btn.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}))
        return true
      }
    }
    return false
  }, code)
  if (ok) await page.waitForTimeout(1500)
  return ok
}

async function scrollSnap(page, key, label, scrollY) {
  await page.evaluate((y) => window.scrollBy(0, y), scrollY)
  await page.waitForTimeout(500)
  await snap(page, key, label)
}

// ── DESKTOP ───────────────────────────────────────────────────────────────────
async function desktop(ctx, key, p) {
  const page = await ctx.newPage()
  await page.setViewportSize({ width: p.w, height: p.h })
  await load(page)

  // ── 1. Insights — All states (hero card)
  await page.waitForSelector('[data-view="insights"]', { timeout: 10_000 })
  await snap(page, key, "insights_all_states")
  await snapFull(page, key, "insights_all_states")

  // ── 2. Map
  if (await gotoTab(page, "Map")) {
    await snap(page, key, "map_view")
    await page.waitForTimeout(1500) // let tiles load
    await snap(page, key, "map_loaded")
  }

  // ── 3. News
  if (await gotoTab(page, "News")) {
    await snap(page, key, "news_feed")
    await snapFull(page, key, "news_feed")
  }

  // ── 4. Videos
  if (await gotoTab(page, "Videos")) {
    await snap(page, key, "videos")
    await snapFull(page, key, "videos")
  }

  // ── 5. Polls
  if (await gotoTab(page, "Polls")) {
    await snap(page, key, "polls")
    await snapFull(page, key, "polls")
  }

  // ── 6–12. DEEP INSIGHTS — state TN
  if (await gotoTab(page, "Insights")) {
    await pickState(page, "TN")
    await snap(page, key, "insights_TN_kpis")                  // KPIs visible
    await snapFull(page, key, "insights_TN_full")              // full page

    // scroll through charts
    await page.mouse.wheel(0, 400); await page.waitForTimeout(500)
    await snap(page, key, "insights_TN_seat_share")

    await page.mouse.wheel(0, 500); await page.waitForTimeout(500)
    await snap(page, key, "insights_TN_charts1")

    await page.mouse.wheel(0, 600); await page.waitForTimeout(500)
    await snap(page, key, "insights_TN_charts2")

    await page.mouse.wheel(0, 600); await page.waitForTimeout(500)
    await snap(page, key, "insights_TN_charts3")

    // Constituency drill-down — pick the first VISIBLE select[aria-label="Constituency"]
    const constOpts = await page.evaluate(() => {
      const sels = [...document.querySelectorAll('select[aria-label="Constituency"]')]
      for (const sel of sels) {
        if (sel.offsetParent == null) continue // skip hidden
        return [...sel.options].map(o => o.text).filter(t => t && t !== "All constituencies")
      }
      return []
    })
    if (constOpts[0]) {
      const picked = await page.evaluate((label) => {
        const sels = [...document.querySelectorAll('select[aria-label="Constituency"]')]
        for (const sel of sels) {
          if (sel.offsetParent == null) continue
          const opt = [...sel.options].find(o => o.text === label)
          if (opt) {
            sel.value = opt.value
            sel.dispatchEvent(new Event("change", { bubbles: true }))
            return true
          }
        }
        return false
      }, constOpts[0])
      if (picked) {
        await page.waitForTimeout(1200)
        await page.evaluate(() => window.scrollTo(0,0))
        await snap(page, key, "insights_constituency_top")
        await snapFull(page, key, "insights_constituency_full")
        await page.mouse.wheel(0, 600); await page.waitForTimeout(500)
        await snap(page, key, "insights_constituency_charts")
      }
    }
  }

  // ── Intel sidebar — open a seat
  const seatBtns = await page.$$('aside button')
  for (const btn of seatBtns) {
    const txt = ((await btn.textContent())||"").trim()
    if (/[A-Z]{2}-\d/.test(txt)) {
      await btn.evaluate(b => b.dispatchEvent(
        new MouseEvent("click",{bubbles:true,cancelable:true,view:window})))
      await page.waitForTimeout(1200)
      await snap(page, key, "intel_seat_drilldown")
      await snapFull(page, key, "intel_seat_full")
      break
    }
  }

  // ── Candidate dossier (click a candidate name in the seat list)
  const candBtns = await page.$$('aside button')
  for (const btn of candBtns) {
    const txt = ((await btn.textContent())||"").trim()
    if (txt.length > 3 && txt.length < 50 && /^[A-Z][a-z]/.test(txt) && !/[A-Z]{2}-\d/.test(txt)) {
      await btn.evaluate(b => b.dispatchEvent(
        new MouseEvent("click",{bubbles:true,cancelable:true,view:window})))
      await page.waitForTimeout(1500)
      await snap(page, key, "candidate_dossier")
      await snapFull(page, key, "candidate_dossier_full")
      // scroll dossier
      await page.mouse.wheel(0, 400); await page.waitForTimeout(400)
      await snap(page, key, "candidate_dossier_scroll")
      break
    }
  }

  await page.close()
}

// ── MOBILE / TABLET ───────────────────────────────────────────────────────────
async function mobile(ctx, key, p) {
  const page = await ctx.newPage()
  await page.setViewportSize({ width: p.w, height: p.h })
  await load(page)

  // ── Insights all-states default
  await page.waitForSelector('[data-view="insights"]', { timeout: 10_000 })
  await snap(page, key, "insights_all_states")
  // Scroll down to see state buttons
  await page.mouse.wheel(0, 300); await page.waitForTimeout(400)
  await snap(page, key, "insights_state_buttons")

  // ── Tab bar — capture it clearly (scroll back to top first)
  await page.evaluate(() => window.scrollTo(0,0))
  await page.waitForTimeout(300)
  await snap(page, key, "tab_bar_overview")

  // ── Map
  if (await gotoTab(page, "Map")) {
    await snap(page, key, "map")
    await page.waitForTimeout(1200)
    await snap(page, key, "map_loaded")
  }

  // ── News
  if (await gotoTab(page, "News")) {
    await snap(page, key, "news")
    await page.mouse.wheel(0, 300); await page.waitForTimeout(400)
    await snap(page, key, "news_scrolled")
  }

  // ── Videos
  if (await gotoTab(page, "Videos")) {
    await snap(page, key, "videos")
  }

  // ── Polls
  if (await gotoTab(page, "Polls")) {
    await snap(page, key, "polls")
  }

  // ── Seats pane
  await navTo(page, "Seats")
  await snap(page, key, "seats_national")
  await page.mouse.wheel(0, 300); await page.waitForTimeout(300)
  await snap(page, key, "seats_list")

  // Pick TN
  if (await pickState(page, "TN")) {
    await snap(page, key, "seats_TN")
    await page.mouse.wheel(0, 400); await page.waitForTimeout(400)
    await snap(page, key, "seats_TN_list")

    // Open a seat
    const seatBtns = await page.$$('button')
    for (const btn of seatBtns) {
      const txt = ((await btn.textContent())||"").trim()
      if (/[A-Z]{2}-\d/.test(txt)) {
        await btn.evaluate(b => b.dispatchEvent(
          new MouseEvent("click",{bubbles:true,cancelable:true,view:window})))
        await page.waitForTimeout(1200)
        await snap(page, key, "seat_drilldown")
        // Candidate in seat
        const candBtns2 = await page.$$('button')
        for (const cb of candBtns2) {
          const ct = ((await cb.textContent())||"").trim()
          if (ct.length > 3 && ct.length < 50 && /^[A-Z][a-z]/.test(ct) && !/[A-Z]{2}-\d/.test(ct)) {
            await cb.evaluate(b => b.dispatchEvent(
              new MouseEvent("click",{bubbles:true,cancelable:true,view:window})))
            await page.waitForTimeout(1500)
            await snap(page, key, "candidate_dossier")
            await page.mouse.wheel(0, 400); await page.waitForTimeout(400)
            await snap(page, key, "candidate_dossier_scroll")
            break
          }
        }
        break
      }
    }
  }

  // ── Back to Dashboard → DEEP INSIGHTS
  await navTo(page, "Dashboard")
  if (await gotoTab(page, "Insights")) {
    // TN should still be active
    await page.evaluate(() => window.scrollTo(0,0)); await page.waitForTimeout(300)
    await snap(page, key, "insights_TN_top")

    // KPIs
    await page.mouse.wheel(0, 200); await page.waitForTimeout(400)
    await snap(page, key, "insights_TN_kpis")

    // Seat share chart
    await page.mouse.wheel(0, 400); await page.waitForTimeout(400)
    await snap(page, key, "insights_TN_seat_share")

    // More charts
    await page.mouse.wheel(0, 500); await page.waitForTimeout(400)
    await snap(page, key, "insights_TN_charts1")

    await page.mouse.wheel(0, 600); await page.waitForTimeout(400)
    await snap(page, key, "insights_TN_charts2")

    await page.mouse.wheel(0, 600); await page.waitForTimeout(400)
    await snap(page, key, "insights_TN_bottom")

    // Constituency pick — visible select only
    const mConstOpts = await page.evaluate(() => {
      const sels = [...document.querySelectorAll('select[aria-label="Constituency"]')]
      for (const sel of sels) {
        if (sel.offsetParent == null) continue
        return [...sel.options].map(o => o.text).filter(t => t && t !== "All constituencies")
      }
      return []
    })
    if (mConstOpts[0]) {
      const mPicked = await page.evaluate((label) => {
        const sels = [...document.querySelectorAll('select[aria-label="Constituency"]')]
        for (const sel of sels) {
          if (sel.offsetParent == null) continue
          const opt = [...sel.options].find(o => o.text === label)
          if (opt) {
            sel.value = opt.value
            sel.dispatchEvent(new Event("change", { bubbles: true }))
            return true
          }
        }
        return false
      }, mConstOpts[0])
      if (mPicked) {
        await page.waitForTimeout(1200)
        await page.evaluate(() => window.scrollTo(0,0))
        await snap(page, key, "insights_constituency")
        await page.mouse.wheel(0, 500); await page.waitForTimeout(400)
        await snap(page, key, "insights_constituency_charts")
      }
    }
  }

  // ── Feed / AI Briefing
  await navTo(page, "Feed")
  await snap(page, key, "ai_briefing")
  await page.mouse.wheel(0, 400); await page.waitForTimeout(400)
  await snap(page, key, "ai_briefing_scroll")

  await page.close()
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: false, slowMo: 120 })
  try {
    for (const key of WANTED) {
      const p = PROFILES[key]
      seq = 0
      console.log(`\n▶ ${key} (${p.w}×${p.h}) [${THEME}]`)
      const ctx = await browser.newContext({
        viewport:          { width: p.w, height: p.h },
        userAgent:         p.ua,
        deviceScaleFactor: p.mobile ? 2 : 1,
        hasTouch:          !!p.touch,
        isMobile:          !!p.mobile,
      })
      if (p.mobile || key === "tablet") await mobile(ctx, key, p)
      else                              await desktop(ctx, key, p)
      await ctx.close()
    }
  } finally {
    await browser.close()
  }
  console.log(`\n✓ Done → ${path.relative(root, OUT_DIR)}`)
}

main().catch(e => { console.error(e); process.exit(1) })
