# Blocked

- Retry 2026-10-03 over ssh. Build status was SUCCEEDED unsigned. Install status was EXIT 1. Cause was missing signature on device 5A3DC1B6. Owner operator. Date 2026-10-03.
- Next micro step is keychain approval on loki console, then rerun device build plus install. Owner operator. Date 2026-10-03.

- Sit at loki console as irellzane and open Terminal. Owner operator. Date 2026-10-02.
- Run partition allow for codesign on loki console with login password. Exact command is `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k LOGINPASSWORD ~/Library/Keychains/login.keychain-db`. Owner operator. Date 2026-10-02.
- Verify one identity line shows 36V92GAJBT. Exact command is `security find-identity -v -p codesigning`. Owner operator. Date 2026-10-02.
- Open portal Identifiers page under team 36V92GAJBT. Owner operator. Date 2026-10-02.
- Create Explicit App ID com.zanishlabs.zot with Push enabled. Owner operator. Date 2026-10-02.
- Create dev profile for com.zanishlabs.zot and double click to install. Owner operator. Date 2026-10-02.
- Record one wake sample on device in quiet room. Owner operator. Date 2026-10-02.
- Replay sample and note trigger result. Owner operator. Date 2026-10-02.

Add items here when only a human can unblock. Keep one line per item with owner and date.
