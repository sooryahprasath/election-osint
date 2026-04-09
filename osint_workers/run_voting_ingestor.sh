#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${ROOT_DIR}/.." && pwd)"

PID_FILE="${ROOT_DIR}/voting_day_ingestor.pid"
LOG_FILE="${ROOT_DIR}/voting_day_ingestor.log"

usage() {
  cat <<'EOF'
Usage:
  ./run_voting_ingestor.sh start
  ./run_voting_ingestor.sh stop
  ./run_voting_ingestor.sh status
  ./run_voting_ingestor.sh tail

What it does:
  - Activates osint_workers/.venv
  - Starts voting_day_ingestor.py in the background
  - Forces a fresh ECINet scrape on each restart (--force-eci)
  - Writes PID to osint_workers/voting_day_ingestor.pid
  - Logs to osint_workers/voting_day_ingestor.log

Required env (in your shell or in ../.env loaded elsewhere):
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY), GEMINI_API_KEY

Recommended env:
  TURNOUT_NUMBERS_SOURCE=eci
  TURNOUT_INGEST_MODE=grounded
  VOTING_INGEST_INTERVAL_SEC=1200
  ECI_SCRAPE_GRACE_MIN=12

EOF
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

is_running_pid() {
  local pid="$1"
  if [[ -z "${pid}" ]]; then return 1; fi
  kill -0 "${pid}" >/dev/null 2>&1
}

get_pid() {
  if [[ -f "${PID_FILE}" ]]; then
    tr -d ' \n\t' <"${PID_FILE}" || true
  else
    echo ""
  fi
}

ensure_venv() {
  if [[ ! -f "${ROOT_DIR}/.venv/bin/activate" ]]; then
    echo "Missing venv at ${ROOT_DIR}/.venv. Create it first:" >&2
    echo "  cd osint_workers && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt" >&2
    exit 1
  fi
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.venv/bin/activate"
}

ensure_google_genai() {
  python3 - <<'PY' >/dev/null 2>&1 && return 0
from google import genai  # noqa
print("ok")
PY

  echo "Installing missing dependency: google-genai" >&2
  python3 -m pip install -q --upgrade pip >/dev/null
  python3 -m pip install -q google-genai >/dev/null
}

cmd="${1:-}"
case "${cmd}" in
  start)
    need_cmd python3
    need_cmd nohup
    ensure_venv
    ensure_google_genai

    # If already running, don't start another copy.
    pid="$(get_pid)"
    if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
      echo "Already running (pid ${pid})."
      exit 0
    fi

    # Defaults (caller can override before running this script)
    : "${TURNOUT_NUMBERS_SOURCE:=eci}"
    : "${TURNOUT_INGEST_MODE:=grounded}"
    : "${VOTING_INGEST_INTERVAL_SEC:=1200}"
    : "${ECI_SCRAPE_GRACE_MIN:=12}"
    : "${TURNOUT_ECI_HEADLESS:=1}" # set 0 to see the browser (requires a DISPLAY)
    export TURNOUT_NUMBERS_SOURCE TURNOUT_INGEST_MODE VOTING_INGEST_INTERVAL_SEC ECI_SCRAPE_GRACE_MIN TURNOUT_ECI_HEADLESS

    # Ensure logs flush immediately.
    export PYTHONUNBUFFERED=1

    mkdir -p "${ROOT_DIR}"
    touch "${LOG_FILE}"
    {
      echo ""
      echo "=== START $(date -Is) ==="
      echo "TURNOUT_NUMBERS_SOURCE=${TURNOUT_NUMBERS_SOURCE} TURNOUT_INGEST_MODE=${TURNOUT_INGEST_MODE} VOTING_INGEST_INTERVAL_SEC=${VOTING_INGEST_INTERVAL_SEC} ECI_SCRAPE_GRACE_MIN=${ECI_SCRAPE_GRACE_MIN} TURNOUT_ECI_HEADLESS=${TURNOUT_ECI_HEADLESS}"
    } >>"${LOG_FILE}"
    echo "Starting voting_day_ingestor (logs: ${LOG_FILE})"
    nohup python3 -u "${ROOT_DIR}/voting_day_ingestor.py" --force-eci >>"${LOG_FILE}" 2>&1 &
    echo $! >"${PID_FILE}"
    echo "Started (pid $(get_pid))."
    ;;

  stop)
    pid="$(get_pid)"
    if [[ -z "${pid}" ]]; then
      echo "Not running (no pid file)."
      exit 0
    fi
    if is_running_pid "${pid}"; then
      echo "Stopping pid ${pid}..."
      kill "${pid}" || true
      # Wait briefly for clean exit
      for _ in {1..20}; do
        if ! is_running_pid "${pid}"; then break; fi
        sleep 0.2
      done
      if is_running_pid "${pid}"; then
        echo "Did not stop gracefully; sending SIGKILL." >&2
        kill -9 "${pid}" || true
      fi
    fi
    rm -f "${PID_FILE}"
    echo "Stopped."
    ;;

  status)
    pid="$(get_pid)"
    if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
      echo "Running (pid ${pid})."
    else
      echo "Not running."
      exit 1
    fi
    ;;

  tail)
    if [[ ! -f "${LOG_FILE}" ]]; then
      echo "No log file yet: ${LOG_FILE}"
      exit 1
    fi
    exec tail -n 200 -f "${LOG_FILE}"
    ;;

  ""|-h|--help|help)
    usage
    ;;

  *)
    echo "Unknown command: ${cmd}" >&2
    usage
    exit 2
    ;;
esac

