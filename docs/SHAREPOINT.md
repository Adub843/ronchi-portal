# SharePoint connection for software downloads

Software packages in the knowledge base can hold links to files on Ronchi's SharePoint instead of
copies in Cloudflare storage. That works with nothing set up: **Download** sends each person to
SharePoint, and their own Microsoft sign-in opens the file.

With the **SharePoint connection** turned on, the portal fetches the file from SharePoint itself
(Microsoft Graph, with its own app sign-in) and passes it straight through. Then:

- staff don't need their own SharePoint access, only the portal's **Download software** switch;
- the download pop-up can save SharePoint files into a folder on the computer, subfolders and all;
- **Upload › Link to files on SharePoint** takes a whole folder link and adds every file inside it.

Nothing is stored in Cloudflare either way. Files stream through the Worker as they download.

## Turning it on (about 10 minutes, needs a Microsoft 365 admin)

1. Sign in to <https://entra.microsoft.com> as a Microsoft 365 admin for Ronchi America.
2. Go to **Identity › Applications › App registrations › New registration**.
   - Name: `Ronchi Portal SharePoint`
   - Supported account types: **Accounts in this organizational directory only**
   - Redirect URI: leave empty. Press **Register**.
3. On the app's **Overview** page, copy two values somewhere safe for the next few minutes:
   **Application (client) ID** and **Directory (tenant) ID**.
4. Go to **API permissions › Add a permission › Microsoft Graph › Application permissions**, tick
   **Sites.Read.All**, and press **Add permissions**. Then press
   **Grant admin consent for Ronchi America** and answer **Yes**. The status column turns green.
   (Read-only: the portal can read SharePoint files but never change or delete them.)
5. Go to **Certificates & secrets › Client secrets › New client secret**. Description
   `ronchi portal`, expires **24 months**, press **Add**. Copy the **Value** column right away
   (not the Secret ID). It is shown only once.
6. On the PC, in the `ronchi-portal` folder, run these three commands. Each one asks you to paste
   a value: the tenant ID, the client ID, then the secret value.

   ```
   npx wrangler secret put MS_TENANT_ID --env production -c wrangler.portal.jsonc
   npx wrangler secret put MS_CLIENT_ID --env production -c wrangler.portal.jsonc
   npx wrangler secret put MS_CLIENT_SECRET --env production -c wrangler.portal.jsonc
   ```

   Secrets take effect straight away; no redeploy is needed.
7. Check it: open **Knowledge base › Manage software**. The line at the top says
   **SharePoint connection: on**. Download one file from a package to be sure.

Put a calendar reminder for a few weeks before the secret expires (step 5). To renew, make a new
secret in the same place and run only the `MS_CLIENT_SECRET` command again.

## If something goes wrong

- If Microsoft refuses the portal's sign-in (wrong value, expired secret, consent removed), the
  portal quietly goes back to sending people to SharePoint, so downloads keep working for anyone
  with SharePoint access. Manage software still says "on" because the secrets are set; check the
  values from steps 3 and 5.
- To turn it off: `npx wrangler secret delete MS_CLIENT_SECRET --env production -c wrangler.portal.jsonc`.

## Tighter option: one site only

**Sites.Read.All** lets the app read every SharePoint site. To limit it to the Help Reference
site, pick **Sites.Selected** in step 4 instead (and grant consent), then give the app read access
to that one site in [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer), signed
in as an admin:

1. `GET https://graph.microsoft.com/v1.0/sites/ronchiam.sharepoint.com:/sites/HelpReferenceDocuments`
   and copy the `id` from the answer.
2. `POST https://graph.microsoft.com/v1.0/sites/{that id}/permissions` with the body
   `{"roles":["read"],"grantedToIdentities":[{"application":{"id":"<client ID>","displayName":"Ronchi Portal SharePoint"}}]}`.

Repeat step 2 for any other site that software is linked from.

Code: `src/portal/lib/sharepoint.ts` (sign-in, download, folder listing) and
`src/portal/routes/software.ts`.
