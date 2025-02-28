
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
        chrome.cookies.get({ url: "https://localhost:8080", name: "hugalugi_access_token" }, async (cookie) => {
            if (chrome.runtime.lastError || !cookie) {
                try {
                    const accessToken = await refreshAccessToken();
                    resolve(accessToken);
                } catch (error) {
                    reject(error);
                }
            }
            else
                resolve(cookie.value);
        });
    });
}


async function refreshAccessToken() {
    const accessTokenPromise = fetch("http://localhost:8080/oauth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
    })
    .then(res => res.json())
    .then(data => data.token);

    accessTokenPromise.then(accessToken => {  // Just for logging purpose
        setAccessToken(accessToken);

        Promise.all([getAccessToken(), getRefreshToken()]).then(([accessToken, refreshToken]) => {
            console.log("New credentials have been issued issued");
            console.log("Access Token:", accessToken);
            console.log("Refresh Token:", refreshToken);
        });
    });

    return accessTokenPromise;
}


function getRefreshToken() {
    return new Promise((resolve, reject) => {
        chrome.cookies.get({ url: "https://localhost:8080", name: "hugalugi_refresh_token" }, (cookie) => {
            if (chrome.runtime.lastError || !cookie) reject(chrome.runtime.lastError);
            else resolve(cookie.value);
        });
    });
}


export default {
    setCredentials,
    setAccessToken,
    getAccessToken,
    setRefreshToken,
    getRefreshToken,
    refreshAccessToken
}