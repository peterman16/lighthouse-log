# Washington Lighthouse Log

A map of Washington's 22 standing historic lighthouses. Visitors can browse it. The owner signs in to log a visit (toured, or seen from shore or a boat), a date, up to five full-resolution photos and a long-form note for each one.

It's plain PHP with no database and no build step, so it runs on ordinary shared hosting such as Hostinger.

## Put it on schmittpictures.com (Hostinger)

1. In hPanel, open **Websites → schmittpictures.com → Advanced → GIT**.
2. Fill in:
   - **Repository:** `https://github.com/peterman16/lighthouse-log.git`
   - **Branch:** `main`
   - **Directory:** `lighthouses` (it must not exist yet)
3. Click **Create**, then **Deploy**. The page is now at `https://schmittpictures.com/lighthouses/`.
4. For automatic updates, click **Auto Deployment** on the same screen and copy the webhook URL. On GitHub, go to this repo's **Settings → Webhooks → Add webhook**, paste the URL as the Payload URL, and save. Every change merged to `main` then goes live on its own.
5. Open the page, tap **Sign in** at the bottom, and create your password (at least 10 characters). The first person to open this screen sets the password, so do it right after the first deploy.

If the repository is private, hPanel shows an SSH key on the GIT screen. Add it under the repo's **Settings → Deploy keys**, and use `git@github.com:peterman16/lighthouse-log.git` as the repository address instead.

## Where your data lives

Visits, photos and the password hash are stored in `lighthouse-data/`, one folder **above** `public_html` (for example `domains/schmittpictures.com/lighthouse-data/`). Deploys never touch this folder, and nobody can download it directly. Photos are served through `photo.php`.

To back everything up, download that folder from Hostinger's File Manager. To reset the password, delete `lighthouse-data/auth.json`, then create a new password from the page.

## Changing the lighthouse list

Edit `lighthouses.json`. Each entry needs an `id` (lowercase, with dashes), `name`, `place`, `region`, `lat`, `lon`, and `lit`, the year the current tower was lit. The list covers standing historic towers. It leaves out demolished or replaced ones (Ediz Hook, Semiahmoo, Slip Point, Smith Island, Willapa Bay), the 1965 replica at Skunk Bay, and modern lights such as Clover Island and Point Roberts.

## Running it locally

```sh
LIGHTHOUSE_DATA=/tmp/lighthouse-data php -S 127.0.0.1:8000
```

Map tiles are © OpenStreetMap contributors © CARTO.
