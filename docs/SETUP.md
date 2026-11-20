# Kids TV setup (for Urjita, about 60 minutes, one time)

You'll do four things: get a free YouTube key, make the shared Sheet and script, put the app online, and add it to your iPhone. Do them in order. Use a laptop for steps 1 to 3.

## 1. Get a free YouTube key (10 min)

1. Go to console.cloud.google.com and sign in with your Google account.
2. At the top, click the project picker, then **New project**. Name it `Kids TV`, click **Create**, and make sure it's selected.
3. In the search bar, type **YouTube Data API v3**, open it, and click **Enable**.
4. Go to **APIs & Services > Credentials**, click **Create credentials > API key**, and copy the key.
5. Click **Edit API key** (or the key's name). Under **API restrictions**, choose **Restrict key**, tick **YouTube Data API v3**, and click **Save**. Leave "Application restrictions" as None; only your Google script uses this key.

It's free. YouTube gives 10,000 units a day and normal use takes well under 1,000.

## 2. Make the shared Sheet and script (20 min)

1. Go to sheets.new. Name the Sheet `Kids TV channels`.
2. Click **Extensions > Apps Script**.
3. Delete everything in the editor, paste in all of `Code.gs`, and click the save icon.
4. Click the gear (**Project Settings**) on the left. Scroll to **Script properties**, then **Add script property** twice:
   - `YT_API_KEY` = the key from step 1
   - `ADMIN_PIN` = a 4 to 6 digit PIN for the grown-ups area (tell your sister and brother-in-law)
   Click **Save script properties**.
5. Back in the editor, pick **testSetup** from the function menu and click **Run**. Google asks for permission: click **Review permissions**, pick your account, then **Advanced > Go to Kids TV (unsafe) > Allow**. "Unsafe" just means Google hasn't reviewed your own script. The log should say `Channels on list: 0` and show Ms Rachel's channel.
6. Click **Deploy > New deployment**. Click the gear next to "Select type" and choose **Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
7. Share the Sheet with your sister as an **Editor**. If the PIN is ever lost, she can see the channel list there, and you can change the PIN in Script properties.

If Claude later changes `Code.gs`: paste the new version, then **Deploy > Manage deployments > edit (pencil) > Version: New version > Deploy**. The URL stays the same.

## 3. Put the app online with GitHub Pages (15 min)

1. Open `app/config.js` in a text editor and paste the Web app URL between the quotes after `SCRIPT_URL:`. Save.
2. On github.com, click **+ > New repository**. Name it `kids-tv`, set it to **Public**, and click **Create repository**.
3. Click **uploading an existing file**, drag in everything inside the `app` folder (not the folder itself), and click **Commit changes**.
4. Go to **Settings > Pages**. Under **Branch**, pick **main** and **/(root)**, then **Save**.
5. After about a minute, the app is live at `https://<your-github-name>.github.io/kids-tv/`. The channel list is public, but nothing else is: adding or removing channels needs the PIN.

Or tell Claude once the repository exists, and Claude can upload the files for you.

## 4. Add it to your iPhone (5 min), then add channels

Follow the parent guide (`PARENT-GUIDE.md`) on your own phone first: add to home screen, open the gear, enter the PIN, and add the channels. Then test with your niece before setting up the other phones.
