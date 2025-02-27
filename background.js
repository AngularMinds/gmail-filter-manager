// const auth = require('./api/auth.js');
import authService from "./service/auth.service.js";

// chrome.runtime.onMessage.addListener((data, sender, response) => {
//     console.log("Received message:", data);
// });

const GMAIL_URL = "https://mail.google.com/mail/"


chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // const url = changeInfo.url;
    const url = tab.url;

    if (url.startsWith(GMAIL_URL))
        chrome.tabs.sendMessage(tabId, { event: "session_init" });
    else
        chrome.tabs.sendMessage(tabId, { event: "session_reset" });
});

chrome.runtime.onMessage.addListener((data, sender, response) => {
    if (data.event == 'block_emails') {

        let emails = data.emails;
        const domain = data.domain;
        const action = data.action;

        if (domain)
            emails = emails.map(email => '@' + email.split('@')[1]);

        console.log("The emails are blocked:", emails);

        fetch("http://localhost:8080/filter/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                emails: emails,
                action: action
            })
        })
            .then((res) => {
                return res.json();
            })
            .then((data) => {
                response({ success: true, data });
            })
            .catch((err) => {
                response({ success: false, err });
            });

        return true;
    }
    else if (data.event == "authenticate") {
        const {access_token, refresh_token} = data.credentials;

        authService.setCredentials(access_token, refresh_token);

        Promise.all([authService.getAccessToken(),authService.getRefreshToken()]).then(function(results) {
            const [accessToken, refreshToken] = results;

            console.log("Access Token:", accessToken);
            console.log("Refresh Token:", refreshToken);
        });

        return true;
    }
    else {
        throw Error("Invalid event");
    }
});


