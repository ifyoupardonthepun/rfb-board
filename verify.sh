#!/usr/bin/env bash
# Run before every push. Fails if anything sensitive would become public.
set -u
BAD=0

F="docs/index.html"
if [ ! -f "$F" ]; then echo "FAIL: $F not found"; exit 1; fi

# 1. Nothing readable in the encrypted page.
for w in Shrey watsonx Snowflake Anthropic Taktile "Data Scientist" Partnerships "Role Fit" 750M salary; do
  if grep -qi -- "$w" "$F"; then echo "LEAK: \"$w\" is readable in $F"; BAD=1; fi
done

# 2. The page must actually be encrypted, not a half-written file.
if ! grep -q 'id="blob"' "$F"; then
  echo "LEAK: $F has no encrypted payload — do not push it."; BAD=1
fi
SIZE=$(wc -c < "$F")
if [ "$SIZE" -lt 100000 ]; then
  echo "WARN: $F is only ${SIZE} bytes — expected ~210KB. Probably truncated."; BAD=1
fi

# 3. The page's inline script must PARSE. A syntax error there means the
#    unlock button silently does nothing: the page looks fine and is dead.
python3 -c "
import re,sys
h=open('docs/index.html',encoding='utf-8').read()
b=re.findall(r'<script(?![^>]*application/json)[^>]*>(.*?)</script>', h, re.S)
open('/tmp/_inline.js','w',encoding='utf-8').write(b[0] if b else 'NO_SCRIPT_FOUND')
" 2>/dev/null
if ! node --check /tmp/_inline.js >/dev/null 2>&1; then
  echo "FAIL: the page's inline script has a syntax error - it will not unlock."
  node --check /tmp/_inline.js 2>&1 | head -4
  BAD=1
fi
rm -f /tmp/_inline.js

# 4. Plaintext sources must not be tracked by git.
for p in rebuild rebuild/roles.json roles.json meta.json; do
  if git ls-files --error-unmatch "$p" >/dev/null 2>&1; then
    echo "LEAK: $p is tracked by git — it contains the plaintext board."; BAD=1
  fi
done

# 5. tools/ is code only; flag it if board data ever lands there.
for p in tools/roles.json tools/meta.json tools/shell.html; do
  if [ -f "$p" ]; then echo "LEAK: $p exists — tools/ is committed and must hold code only."; BAD=1; fi
done

if [ "$BAD" -eq 0 ]; then
  echo "OK: page is encrypted, nothing sensitive readable, no plaintext tracked."
else
  echo; echo "Do not push until these are resolved."; exit 1
fi
