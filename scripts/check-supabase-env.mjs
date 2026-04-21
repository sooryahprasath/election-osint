import fs from "fs"

const parseEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return {}
  const txt = fs.readFileSync(filePath, "utf8")
  const out = {}
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const i = line.indexOf("=")
    if (i < 1) continue
    const key = line.slice(0, i).trim()
    let value = line.slice(i + 1).trim()
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1)
    out[key] = value
  }
  return out
}

const env = { ...parseEnvFile(".env"), ...parseEnvFile(".env.local") }
const url = env.NEXT_PUBLIC_SUPABASE_URL || ""
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""

console.log(
  JSON.stringify({
    url,
    anonLen: anon.length,
    anonStarts: anon.slice(0, 8),
    anonEnds: anon.slice(-8),
    hasWhitespace: /\s/.test(anon),
  })
)

