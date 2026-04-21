/**
 * Captures UI screenshots for local review (Playwright).
 * Prereq: dev server running (npm run dev) on BASE_URL (default http://127.0.0.1:3000).
 *
 * Run: node scripts/capture-ui.mjs
 */

import { chromium } from "playwright"
import { mkdir } from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")
const outDir = path.join(root, "artifacts", "ui-screenshots")

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000"

/** Center mode / sub-tab clicks: ignore LIVE TURNOUT + EXIT POLLS row so "LIVE" does not mis-click. */
async function clickMainButtonContaining(page, substring) {
  await page.evaluate((sub) => {
    const main = document.querySelector("main")
    if (!main) return
    const buttons = Array.from(main.querySelectorAll("button"))
    const btn = buttons.find((b) => {
      const t = (b.textContent || "").replace(/\s+/g, " ").trim()
      if (t.includes("LIVE TURNOUT") || t.includes("EXIT POLLS")) return false
      return t.includes(sub)
    })
    if (btn) btn.click()
  }, substring)
  await page.waitForTimeout(900)
}

/** Prefer exact center chip labels (avoids TopBar "LIVE" ticker noise outside main). */
async function clickCenterModeIfPresent(page, modeSubstrings) {
  const picked = await page.evaluate((subs) => {
    const main = document.querySelector("main")
    if (!main) return null
    const buttons = Array.from(main.querySelectorAll("button"))
    for (const sub of subs) {
      const btn = buttons.find((b) => {
        const t = (b.textContent || "").replace(/\s+/g, " ").trim()
        if (t.includes("LIVE TURNOUT") || t.includes("EXIT POLLS")) return false
        return t === sub || t.includes(sub)
      })
      if (btn) {
        btn.click()
        return sub
      }
    }
    return null
  }, modeSubstrings)
  await page.waitForTimeout(900)
  return picked
}

/** Mobile bottom bar only — avoid matching SignalPane "◆ AI BRIEFING" collapse control. */
async function clickMobileTab(page, label) {
  const bar = page.locator("div.md\\:hidden.fixed.bottom-0.shadow-lg")
  await bar.getByRole("button", { name: label, exact: true }).click()
  await page.waitForTimeout(900)
}

async function capture(name, page) {
  const safe = name.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()
  const file = path.join(outDir, `${safe}.png`)
  await page.screenshot({ path: file, fullPage: true })
  console.log("wrote", path.relative(root, file))
}

async function main() {
  await mkdir(outDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()

  const desktop = await context.newPage()
  desktop.setDefaultTimeout(90_000)
  await desktop.goto(BASE_URL, { waitUntil: "domcontentloaded" })
  await desktop.waitForSelector("main", { state: "visible", timeout: 60_000 })
  await desktop.waitForTimeout(2500)

  await desktop.setViewportSize({ width: 1440, height: 900 })
  await capture("01_desktop_initial", desktop)

  const centerModes = ["SIGNALS", "VIDEOS", "MAP", "POLLS"]
  for (const mode of centerModes) {
    await clickMainButtonContaining(desktop, mode)
    await capture(`02_desktop_center_${mode}`, desktop)
  }

  const livePicked = await clickCenterModeIfPresent(desktop, [
    "VOTING LIVE",
    "COUNTING LIVE",
    "LIVE",
  ])
  if (livePicked) {
    await capture(`03_desktop_center_${livePicked.replace(/\s+/g, "_")}_turnout`, desktop)
    await clickMainButtonContaining(desktop, "EXIT POLLS")
    await capture(`04_desktop_center_${livePicked.replace(/\s+/g, "_")}_exit_polls`, desktop)
  }

  await clickMainButtonContaining(desktop, "SIGNALS")

  const mobile = await context.newPage()
  mobile.setDefaultTimeout(90_000)
  await mobile.goto(BASE_URL, { waitUntil: "domcontentloaded" })
  await mobile.waitForSelector("main", { state: "visible", timeout: 60_000 })
  await mobile.waitForTimeout(2000)
  await mobile.setViewportSize({ width: 390, height: 844 })

  await clickMobileTab(mobile, "AI BRIEFING")
  await capture("10_mobile_tab_briefing", mobile)
  await clickMobileTab(mobile, "CENTER")
  await capture("11_mobile_tab_center_signals_default", mobile)
  for (const mode of centerModes) {
    await clickMainButtonContaining(mobile, mode)
    await capture(`12_mobile_center_${mode}`, mobile)
  }
  await clickMobileTab(mobile, "INTEL")
  await capture("13_mobile_tab_intel", mobile)

  await browser.close()
  console.log("\nDone. Open folder:", outDir)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
