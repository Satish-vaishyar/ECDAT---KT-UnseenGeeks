# Smart App Control blocks the EXE (strictest case — handle FIRST)

**What the judge will see:** blue dialog — *"Smart App Control blocked
an app that may be unsafe ... we could not verify its publisher."*

**Say (one line):** "Same cause — student build, no paid certificate.
This one can't be clicked through; it needs a 30-second settings change."

**Fix (once per machine):**
1. Settings → Privacy & Security → Windows Security
2. App & browser control → **Smart App Control settings** → **Off**
3. Re-run the installer. No reboot needed.

**Fallback (no settings change allowed):** skip the EXE entirely —
run `QIROVA-LAUNCH.cmd` from the installed/colleague folder instead.
Scripts run under Microsoft-signed `powershell.exe`, so Smart App
Control lets them through; the launcher now auto-installs Python
3.12 per-user if missing, then sets up the backend itself.

# SmartScreen presenter script — "Unknown publisher" warning

**What the judge will see:** blue dialog — *"Windows protected your PC /
Microsoft Defender SmartScreen prevented an unrecognized app from starting."*

**Say (one line):** "Expected — this is a student build with no paid EV
certificate, not malware. The code is on GitHub for inspection."

**Exact clicks:** 1. Click **More info** (under the text) → publisher shows
"Unknown". 2. Click **Run anyway** → setup continues normally.

**Why it appears:** SmartScreen flags any `.exe` without an Extended
Validation code-signing cert (~$200–400/yr). SIH builds ship unsigned.

**Trust check (run live before clicking Run anyway):**

```cmd
certutil -hashfile QIROVA-Setup.exe SHA256
certutil -hashfile qirova-ide-1.0.0.vsix SHA256
```

Read the hashes aloud, compare with the values in the GitHub release notes.
Match = untampered. Then click **Run anyway**.

**If asked "why not sign it?":** "Student budget — signing is the only gap;
everything else (hash verification, source, offline installer) is reproducible."
