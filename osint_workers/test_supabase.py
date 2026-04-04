# test_supabase.py
import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Load .env file
load_dotenv()

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")

print("=== Supabase Connectivity Test ===")
print(f"URL loaded: {SUPABASE_URL}")
if SUPABASE_KEY:
    print(f"KEY loaded: {SUPABASE_KEY[:15]}...[HIDDEN]...{SUPABASE_KEY[-5:]}")
else:
    print("KEY loaded: NONE")

try:
    print("\nAttempting to connect...")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # Try to fetch 1 row from the constituencies table to prove read access
    response = supabase.table("constituencies").select("id").limit(1).execute()
    
    print("\n✅ SUCCESS! Connected to Supabase.")
    print(f"✅ Read Test Passed: Found data -> {response.data}")
    
except Exception as e:
    print(f"\n❌ FAILED! Could not connect or read from Supabase.\nError Details: {e}")