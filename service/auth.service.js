
function setCredentials(access_token, refresh_token) {
    setAccessToken(access_token);
    setRefreshToken(refresh_token);
}

function setAccessToken(access_token) {
    chrome.cookies.set({
        url: "https://localhost:8080",
        name: "hugalugi_access_token",
        value: access_token,
        expirationDate: Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
    });
}

function setRefreshToken(refresh_token) {
    chrome.cookies.set({
        url: "https://localhost:8080",
        name: "hugalugi_refresh_token",
        value: refresh_token,
        httpOnly: true,
        expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 * 6 // 6 months from now
    });
}

function getAccessToken() {
    return new Promise((resolve, reject) => {
        chrome.cookies.get({ url: "https://localhost:8080", name: "hugalugi_access_token" }, (cookie) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(cookie ? cookie.value : null);
        });
    });
}

function getRefreshToken() {
    return new Promise((resolve, reject) => {
        chrome.cookies.get({ url: "https://localhost:8080", name: "hugalugi_refresh_token" }, (cookie) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(cookie ? cookie.value : null);
        });
    });
}


export default {
    setCredentials,
    setAccessToken,
    getAccessToken,
    setRefreshToken,
    getRefreshToken
}