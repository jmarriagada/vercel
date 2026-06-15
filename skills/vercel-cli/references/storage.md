# Blob Storage

`vercel blob` manages Vercel Blob storage — simple file storage for uploading, listing, and deleting files.

```bash
vercel blob put ./image.png                              # upload
vercel blob put ./image.png --pathname images/photo.png  # custom path
vercel blob put ./large.zip --multipart                  # large files
vercel blob list                                         # list blobs
vercel blob list --prefix images/                        # filter by prefix
vercel blob del <url-or-pathname>                        # delete
vercel blob copy <from-url> <to-pathname>                # copy
```

## Authentication

Every `vercel blob` command needs credentials for **one specific store**. There are two mutually exclusive modes:

| Mode | Credentials | Use for |
| --- | --- | --- |
| **Read-write token** | `BLOB_READ_WRITE_TOKEN` (encodes the store id) | scripts, CI, anything non-interactive — it is long-lived |
| **OIDC** | `VERCEL_OIDC_TOKEN` **and** `BLOB_STORE_ID` together | local dev against a linked project — the token is **short-lived** |

Resolution order (first match wins):

1. **Explicit flags.** `--rw-token <token>`, or `--oidc-token <jwt> --store-id <store_…>`. The two OIDC flags must be passed **together** — passing only one is an error, not a fallback to the RW token.
2. **Environment** (`process.env`, then `.env.local`). In each source: if exactly one of `VERCEL_OIDC_TOKEN` / `BLOB_STORE_ID` is set it's a hard error (partial OIDC config is never silently downgraded); if both are set → OIDC; else if `BLOB_READ_WRITE_TOKEN` is set → RW token.
3. **Linked project.** Run `vercel link` (or `vercel env pull`) in a folder linked to a project that has a Blob store connected, and the credentials are pulled into `.env.local` for you.

```bash
# Non-interactive / CI — prefer the read-write token
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_… vercel blob list

# OIDC — store id comes from BLOB_STORE_ID, no --store-id flag needed
VERCEL_OIDC_TOKEN=… BLOB_STORE_ID=store_… vercel blob list
```

> **`VERCEL_OIDC_TOKEN` is short-lived and refreshes.** Do **not** hard-code it into a script or `.env` you keep around — a captured value stops working once it expires. For anything long-running or automated, use `BLOB_READ_WRITE_TOKEN` instead.

## Store Management

```bash
vercel blob create-store my-store --access private     # create a new store
vercel blob get-store <store-id>                       # show store details
vercel blob delete-store <store-id> --yes              # remove a store
vercel blob empty-store --yes                          # delete all blobs in the selected store
vercel blob list-stores --all --json                   # list stores
```
