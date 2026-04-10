"""Log every response URL (sample) to see what Playwright sees."""
from playwright.sync_api import sync_playwright

URL = "https://ecinet.eci.gov.in/home/eciUpdates"

if __name__ == "__main__":
    all_urls: list[tuple[int, str]] = []

    def on_response(resp):
        try:
            all_urls.append((resp.status, resp.url))
        except Exception:
            pass

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = browser.new_page()
        page.on("response", on_response)
        page.goto(URL, wait_until="domcontentloaded", timeout=120_000)
        page.wait_for_timeout(40_000)
        browser.close()

    press = [x for x in all_urls if "press" in x[1].lower() or "eci-backend" in x[1].lower()]
    with open("_eci_explore_out.txt", "w", encoding="utf-8") as f:
        f.write(f"total responses={len(all_urls)}\n")
        f.write(f"press/backend subset={len(press)}\n\n")
        for row in press:
            f.write(f"{row[0]} {row[1]}\n")
        f.write("\n--- last 30 any ---\n")
        for row in all_urls[-30:]:
            f.write(f"{row[0]} {row[1][:160]}\n")
    print("wrote _eci_explore_out.txt", "press_like", len(press), "total", len(all_urls))
