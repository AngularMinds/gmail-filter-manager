
function setCredentials(access_token, refresh_token) {
    chrome.storage.local.set({
        access_token,
        refresh_token
    });
}

function getAccessToken() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get("access_token", (result) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(result.access_token || null);
        });
    });
}

function getRefreshToken() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get("refresh_token", (result) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(result.refresh_token || null);
        });
    });
}

export default {
    setCredentials,
    getAccessToken,
    getRefreshToken
}