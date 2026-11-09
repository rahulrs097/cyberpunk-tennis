# Billboard ads

Every picture in this folder takes a turn on the sky billboard, 8 seconds each, between turns of the HHORNS photo. The words (ACE, WINNER, OOPS...), line calls and zen mode's score still take over the sign as before.

- **Add an ad:** upload a PNG, JPG or WebP here (on GitHub: Add file, then Upload files) and commit to `main`. It's live about a minute later, once Cloudflare has deployed, in the browser and in the Play Store app alike.
- **Remove one:** delete its file.
- **Order:** by file name, so start names with a number (`01-garage.png`, `02-cafe.jpg`).
- **Size:** about 1040 × 336 px (the sign is a little over 3 : 1). Other shapes are cropped to fill it from the middle. Keep each file under about 200 KB.

`list.json` is written by the deploy (`tools/ads-list.js`), so there's nothing else to edit.
