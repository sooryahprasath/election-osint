import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")

try:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("Supabase credentials missing.")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
except Exception as e:
    print(f"CRITICAL: Supabase offline: {e}")
    supabase = None

# ------------------------------------------------------------------------
# 2026 ECI VERIFIED GROUND TRUTH DATA
# Phase 1 (April 9): Kerala, Assam, Puducherry
# Phase 2 (April 23): Tamil Nadu, West Bengal
# ------------------------------------------------------------------------

CONSTITUENCIES =[
    # --- KERALA (Phase 1) ---
    {"id": "KER-016", "name": "Payyannur", "state": "Kerala", "constituency_number": 16, "phase": 1, "polling_date": "2026-04-09", "lat": 12.1010, "lng": 75.2030},
    {"id": "KER-098", "name": "Puthuppally", "state": "Kerala", "constituency_number": 98, "phase": 1, "polling_date": "2026-04-09", "lat": 9.5539, "lng": 76.5490},
    {"id": "KER-012", "name": "Dharmadom", "state": "Kerala", "constituency_number": 12, "phase": 1, "polling_date": "2026-04-09", "lat": 11.7820, "lng": 75.4540},
    {"id": "KER-114", "name": "Kazhakkoottam", "state": "Kerala", "constituency_number": 114, "phase": 1, "polling_date": "2026-04-09", "lat": 8.5686, "lng": 76.8682},
    {"id": "KER-088", "name": "Kottayam", "state": "Kerala", "constituency_number": 88, "phase": 1, "polling_date": "2026-04-09", "lat": 9.5916, "lng": 76.5222},

    # --- ASSAM (Phase 1)[POST-2023 DELIMITATION UPDATES] ---
    {"id": "ASM-106", "name": "Kaziranga", "state": "Assam", "constituency_number": 106, "phase": 1, "polling_date": "2026-04-09", "lat": 26.5775, "lng": 93.1711}, # New AC
    {"id": "ASM-053", "name": "Gauhati East", "state": "Assam", "constituency_number": 53, "phase": 1, "polling_date": "2026-04-09", "lat": 26.1445, "lng": 91.7362},
    {"id": "ASM-113", "name": "Silchar", "state": "Assam", "constituency_number": 113, "phase": 1, "polling_date": "2026-04-09", "lat": 24.8333, "lng": 92.7789}, # Realigned AC
    {"id": "ASM-033", "name": "Jalukbari", "state": "Assam", "constituency_number": 33, "phase": 1, "polling_date": "2026-04-09", "lat": 26.1557, "lng": 91.6629},
    {"id": "ASM-099", "name": "Majuli", "state": "Assam", "constituency_number": 99, "phase": 1, "polling_date": "2026-04-09", "lat": 26.9500, "lng": 94.1667},

    # --- TAMIL NADU (Phase 2) ---
    {"id": "TN-011", "name": "Dr. Radhakrishnan Nagar", "state": "Tamil Nadu", "constituency_number": 11, "phase": 2, "polling_date": "2026-04-23", "lat": 13.1231, "lng": 80.2785},
    {"id": "TN-013", "name": "Kolathur", "state": "Tamil Nadu", "constituency_number": 13, "phase": 2, "polling_date": "2026-04-23", "lat": 13.1158, "lng": 80.2132},
    {"id": "TN-120", "name": "Coimbatore South", "state": "Tamil Nadu", "constituency_number": 120, "phase": 2, "polling_date": "2026-04-23", "lat": 10.9995, "lng": 76.9667},
    {"id": "TN-019", "name": "Chepauk-Thiruvallikeni", "state": "Tamil Nadu", "constituency_number": 19, "phase": 2, "polling_date": "2026-04-23", "lat": 13.0630, "lng": 80.2820},
    {"id": "TN-089", "name": "Edappadi", "state": "Tamil Nadu", "constituency_number": 89, "phase": 2, "polling_date": "2026-04-23", "lat": 11.5835, "lng": 77.8427},

    # --- WEST BENGAL (Phase 2) ---
    {"id": "WB-147", "name": "Nandigram", "state": "West Bengal", "constituency_number": 147, "phase": 2, "polling_date": "2026-04-23", "lat": 22.0044, "lng": 87.9781},
    {"id": "WB-159", "name": "Bhabanipur", "state": "West Bengal", "constituency_number": 159, "phase": 2, "polling_date": "2026-04-23", "lat": 22.5354, "lng": 88.3475},
    {"id": "WB-188", "name": "Singur", "state": "West Bengal", "constituency_number": 188, "phase": 2, "polling_date": "2026-04-23", "lat": 22.8105, "lng": 88.2285},
    {"id": "WB-294", "name": "Rampurhat", "state": "West Bengal", "constituency_number": 294, "phase": 2, "polling_date": "2026-04-23", "lat": 24.1678, "lng": 87.7770},

    # --- PUDUCHERRY (Phase 1) ---
    {"id": "PY-010", "name": "Kamaraj Nagar", "state": "Puducherry", "constituency_number": 10, "phase": 1, "polling_date": "2026-04-09", "lat": 11.9446, "lng": 79.8080},
    {"id": "PY-014", "name": "Ozhukarai", "state": "Puducherry", "constituency_number": 14, "phase": 1, "polling_date": "2026-04-09", "lat": 11.9560, "lng": 79.7738},
]

def seed_database():
    print("=== DHARMA-OSINT: Seeding Verified Constituency Baseline ===")
    
    if not supabase:
        print("CRITICAL ERROR: Supabase connection failed.")
        return

    success_count = 0
    for c in CONSTITUENCIES:
        try:
            # We use an UPSERT (insert or update) so this script can be run safely multiple times
            payload = {
                "id": c["id"],
                "name": c["name"],
                "state": c["state"],
                "constituency_number": c["constituency_number"],
                "phase": c["phase"],
                "polling_date": c["polling_date"],
                "latitude": c["lat"],
                "longitude": c["lng"],
                "volatility_score": 0.0, # Will be driven up dynamically by AI signals
                "status": "pending"
            }
            
            # Using UPSERT logic via the unique ID
            supabase.table("constituencies").upsert(payload).execute()
            print(f" [+] Verified & Locked: {c['name']} ({c['id']}) - Phase {c['phase']}")
            success_count += 1
            
        except Exception as e:
            print(f" [!] Failed to lock {c['id']}: {e}")

    print(f"\n[✓] Successfully seeded {success_count}/{len(CONSTITUENCIES)} critical battlegrounds.")

if __name__ == "__main__":
    seed_database()