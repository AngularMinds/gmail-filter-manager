console.log("This is from popup");

document.addEventListener("DOMContentLoaded", () => {

    const submit_btn = document.getElementById("submit"); // Ensure 'submit' exists
    submit_btn.addEventListener("click", function() {
        chrome.tabs.create({ url: "http://localhost:5501" });

        // chrome.runtime.sendMessage({ event: "sample" }, (response) => {
        //     console.log("Received response:", response);
        // });
    });

});