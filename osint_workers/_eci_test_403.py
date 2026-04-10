from playwright.sync_api import sync_playwright

API = (
    "https://www.eci.gov.in/eci-backend/public/api/get-press-release"
    "?days=ZgJdNIYJFQ8oHdVxwRee3w%253D%253D&page=dcV2gO8KwBZenC3xsJK6eg%253D%253D"
)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--no-sandbox"])
    ctx = b.new_context(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122 Safari/537.36"
        ),
        locale="en-IN",
    )
    page = ctx.new_page()
    page.goto("https://ecinet.eci.gov.in/home/eciUpdates", wait_until="domcontentloaded", timeout=120_000)
    page.wait_for_timeout(2000)
    req = ctx.request
    r = req.get(
        API,
        headers={
            "Referer": "https://ecinet.eci.gov.in/",
            "Origin": "https://ecinet.eci.gov.in",
            "Accept": "application/json, text/plain, */*",
        },
    )
    print("api_request status", r.status)
    print(r.text()[:500])
    b.close()
