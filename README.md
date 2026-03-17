# Gmail Filter Manager

A Chrome extension to bulk-manage Gmail filters directly from your inbox. Select emails, pick actions, and create filters in seconds.

## Features

- **Bulk filter creation** — Select multiple emails in Gmail, choose actions (mark read, archive, delete, label), and create a Gmail filter in one click
- **Smart filter merging** — Automatically merges new senders into existing filters with the same action, staying within Gmail's character limits
- **Apply to existing emails** — Filters are immediately applied to all matching emails already in your inbox
- **Multi-account support** — Connect multiple Google accounts and switch between them seamlessly
- **Filter group management** — View, edit, and delete filter groups from the popup
- **Auto-refresh** — Gmail reloads automatically after filters are applied

## Installation

1. Clone this repo:
   ```
   git clone git@github.com:AngularMinds/byebyesender.git
   ```
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the cloned folder
5. Open Gmail — select emails and the filter toolbar appears at the bottom

## Usage

1. Open Gmail and select one or more emails using the checkboxes
2. A toolbar appears at the bottom with filter options:
   - **Mark Read** — marks matching emails as read
   - **Archive** — removes from inbox
   - **Delete** — moves to trash
   - **Label** — applies a Gmail label (create new labels on the fly)
3. Click **Create Filter** to create a persistent Gmail filter and apply it to existing emails
4. Manage your filter groups from the extension popup

## How It Works

- Uses the Gmail API with OAuth2 + PKCE for secure authentication
- Filters are created via Gmail's `settings/filters` API
- Existing emails are batch-modified using `messages/batchModify`
- Filter groups are stored locally per account using `chrome.storage`

## Permissions

- `identity` — Google OAuth sign-in
- `storage` — Store account tokens and filter groups locally
- `activeTab` — Interact with the Gmail tab
- `googleapis.com` — Gmail API access for filters and messages
