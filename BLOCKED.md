# Blocked

- Device install needs one keychain approval on loki console then retry build plus install. Retry log shows wrong passphrase so app stayed unsigned and install failed. Exact prompt is `security: SecKeychainItemSetAccessWithPassword: The user name or passphrase you entered is not correct.` Exact console command is `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k LOGINPASSWORD ~/Library/Keychains/login.keychain-db`. Run on loki console then rerun device build plus install. Owner operator. Date 2026-10-01.
- Explicit App ID needs portal step by account holder. Create Explicit App ID com.zot.app under team 36V92GAJBT with Push Notifications enabled then make a development profile and install in Xcode. Retry log team Y8FVTH86T8 is wrong. Use 36V92GAJBT. No keys in this step. Owner operator. Date 2026-10-01.
- Voice wake word tuning needs on device mic testing. Owner operator. Date 2026-10-01.

Add items here when only a human can unblock. Keep one line per item with owner and date.
