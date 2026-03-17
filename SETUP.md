# Gmail Filter Manager - Setup Guide

## Step 1: Create Google Cloud Project & OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Enable the **Gmail API**:
   - Go to APIs & Services > Library
   - Search "Gmail API" and click Enable
4. Create OAuth credentials:
   - Go to APIs & Services > Credentials
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Chrome Extension" as the application type
   - Enter your extension ID (you'll get this after loading the extension once - see step 2)
   - Copy the **Client ID**
5. Configure the OAuth consent screen:
   - Go to APIs & Services > OAuth consent screen
   - Set up as "External" (or "Internal" if using Google Workspace)
   - Add your email as a test user

## Step 2: Get Your Extension ID

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked" and select this folder
4. Copy the **Extension ID** shown under the extension name

## Step 3: Configure the Extension

1. Open `manifest.json`
2. Replace `YOUR_CLIENT_ID.apps.googleusercontent.com` with your actual OAuth Client ID
3. Go back to Google Cloud Console > Credentials
4. Edit your OAuth client ID and add the extension ID from Step 2

## Step 4: Reload & Authorize

1. Go to `chrome://extensions/` and click the reload button on the extension
2. Open Gmail in a new tab
3. Click the extension icon in the toolbar
4. Click "Connect" to authorize with your Gmail account
5. Grant the requested permissions

## Usage

1. **Select emails** in Gmail using the checkboxes
2. A **floating toolbar** appears at the bottom with quick actions:
   - **Mark Read** - marks selected emails as read
   - **Archive** - archives selected emails
   - **Label** - move to a label (with search/create)
   - **Delete** - deletes selected emails
   - **Create Filter** - creates a Gmail filter for the senders of selected emails

3. **Create Filter** flow:
   - Shows the sender emails extracted from your selection
   - Choose what should happen: mark read, archive, delete, apply label, etc.
   - Optionally apply to existing emails from those senders
   - The extension **merges senders into existing filters** with matching actions
   - If a filter is full (too many senders), it creates an overflow filter automatically

4. **Manage filters** via the extension popup:
   - See all your filter groups
   - View/remove individual senders
   - Delete entire filter groups
