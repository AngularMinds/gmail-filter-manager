// const auth = require('./api/auth.js');

// chrome.runtime.onMessage.addListener((data, sender, response) => {
//     console.log("Received message:", data);
// });

const GMAIL_URL = "https://mail.google.com/mail/"


chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // const url = changeInfo.url;
    const url = tab.url;
    
    if(url.startsWith(GMAIL_URL))
        chrome.tabs.sendMessage(tabId,{ event: "session_init" });
    else
        chrome.tabs.sendMessage(tabId,{ event: "session_reset" });
});

chrome.runtime.onMessage.addListener((data, sender, response) => {
    if(data.event=='block_emails'){

        let emails = data.emails;
        const domain = data.domain;
        const action = data.action;

        if(domain)
            emails = emails.map(email => '@'+email.split('@')[1]);

        console.log("The emails are blocked:",emails);
        
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
    else{
        throw Error("Invalid event");
    }
});