# QIROVA IDE — Updates

Two ship formats: **full setup** (`QIROVA-Setup.exe`, everything bundled) and
**vsix swap** (`qirova-ide-*.vsix`, extension only, for small fixes).

## How to check

```cmd
packaging\check-update.cmd
packaging\check-update.cmd --quiet & echo %errorlevel%
```

`--quiet`: exit `1` = update available, `0` = current or unknown (offline?).
No downloads are performed; offline/404 prints `could not check (offline?)`.

Local version: `resources\app\extensions\qirova-ide\package.json` (`1.0.0`).
Remote: `https://raw.githubusercontent.com/snnxndnsjdnsn/ECDAT-IDE/main/VERSION`.
Releases/changelog: `https://github.com/snnxndnsjdnsn/ECDAT-IDE/releases`.

## How to update

- **Small fix:** download the new `.vsix` from Releases, back up the old one,
  then copy the new `out/` + `package.json` into
  `resources\app\extensions\qirova-ide\` (or reinstall the vsix).
- **Big change:** run the new `QIROVA-Setup.exe` over the old folder.

## Rollback

Keep the previous `.vsix` before every update — restore it the same way
(copy `out/` + `package.json` back). Full-setup rollback = rerun old setup.
When in doubt before a demo: don't update.
