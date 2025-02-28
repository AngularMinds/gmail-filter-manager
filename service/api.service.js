
const block_emails = function (payload) {
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
}

export default {
    block_emails
};