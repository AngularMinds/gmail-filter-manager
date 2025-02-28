let session = {
    isActive: false,
    extensionInterface: undefined,

    init: function (verbose = false) {
        this.isActive = true;
        if (verbose)
            console.log("session initilised");

        this.extensionInterface = createExtensionInterface();
        const toolBar = document.body.children[22].children[2].children[0].children[1].children[1].children[0].children[0].children[0].children[0].children[0].children[0].children[0].children[0].children[0];
        toolBar.appendChild(this.extensionInterface);
    },

    reset: function (verbose = false) {
        this.extensionInterface.remove();
        this.extensionInterface = undefined;

        this.isActive = false;
        if (verbose)
            console.log("session destroyed");
    }
};

window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.identity!=="HUGALUGI") return;
    console.log(event.data);
    
    chrome.runtime.sendMessage({ event: 'authenticate', credentials: event.data.credentials });
});

chrome.runtime.onMessage.addListener((data, sender, response) => {
    if (data.event == "session_init") {
        if (!session.isActive) {
            session.init(verbose = true);
        }
    }
    else if (data.event == "session_reset") {
        if (session.isActive)
            session.reset(verbose = true);
    }
    else
        console.log("WTF event");
});


const invokeAPI = async function (payload) {
    const approval = await Toast.createConfirmationToast("The action cannot be undone. The emails will be blocked permanantely.");

    if (!approval)
        return;

    const loader = Toast.createLoadingToast("API request in progress ...");
    document.body.appendChild(loader);

    chrome.runtime.sendMessage(payload, (response) => {
        loader.remove();
        unselectSelectedEmails();

        if (response.success)
            Toast.createAlertToast("SUCCESS, emails have been blocked!");
        else
            Toast.createAlertToast("SORRY, something went wrong!");
    });
}



const invokeExtension = async function () {
    // TODO
}

const createExtensionModal = async function() {
    const crux = `
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Roboto&display=swap');

        .overlay {
            position: fixed;
            top: 0px;
            right: 0px;
            height: 100vh;
            width: 100vw;
            background-color: #2222229a;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }

        .overlay *{
            z-index: 1000;
        }

        .overlay-modal {
            height: auto;
            width: 500px;
            background-color: #FEFDFA;
            padding: 1.5rem;
            border-radius: 0.5rem;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
            text-align: left;
            position: relative;
        }

        .overlay-modal h2 {
            margin-bottom: 20px;
            color: #B8875D;
            text-align: center;
        }

        .overlay-modal #selected-emails {
            width: 95%;
            padding: 12px;
            margin-bottom: 20px;
            border: 1px solid #ccc;
            border-radius: 5px;
            font-size: 16px;
        }

        .overlay-modal label {
            display: block;
            margin: 10px 0;
            font-size: 14px;
            color: #555;
        }

        .overlay-modal .radio-group {
            display: flex;
            margin-bottom: 20px;
        }

        .overlay-modal .radio-group label {
            margin-right: 1rem; /* Add gap between radio buttons */
        }

        .overlay-modal input[type="radio"],
        .overlay-modal input[type="checkbox"] {
            margin-right: 10px;
        }

        .cancel-icon {
            position: absolute;
            top: 1rem;
            right: 1rem;
            width: 2rem;
            height: 2rem;
            padding: 0.25rem;
            border-radius: 50%;
            cursor: pointer;
            
        }

        .cancel-icon:hover{
            background-color: rgba(211, 211, 211, 0.35);
            transition: 250ms ease-in-out;
        }

        #selected-emails{
            display: flex;
            flex-wrap: wrap; 
            gap: 0.75rem;

            max-height: 100px;
            overflow-y: auto;
        }

        #selected-emails::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }
        
        #selected-emails::-webkit-scrollbar-track {
            background: #f1f1f1;
            border-radius: 10px;
        }
        
        #selected-emails::-webkit-scrollbar-thumb {
            background: #888;
            border-radius: 10px;
        }
        
        #selected-emails::-webkit-scrollbar-thumb:hover {
            background: #555;
        }

        #hugalugi-submit {
            padding: 0.5rem 1rem;
            color: rgb(122, 89, 3);
            background-color: #F4DBA6;
            border: 1px solid darkgoldenrod;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            transition: background-color 0.3s;
            float: right;
        }

        #hugalugi-submit:hover {
            color: black;
            border: 1px solid black;
        }
    </style>

    <div class="overlay">
        <div class="overlay-modal">
            <svg class="cancel-icon" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#B7B7B7">
            <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
            </svg>
            <h2>HUGALUGI</h2>
            <label for="selected-emails">Selected emails</label>
            <div id="selected-emails"></div>

            <label>
                <input type="checkbox" id="hugalugi-applyToAll"> Apply to all domains
            </label>

            <div class="radio-group">
                <label>
                    <input type="radio" name="filter" value="SPAM"> Spam
                </label>
                <label>
                    <input type="radio" name="filter" value="TRASH"> Trash
                </label>
                <label>
                    <input type="radio" name="filter" value="ARCHIVE"> Archive
                </label>
            </div>

            <button id="hugalugi-submit" type="submit">Submit</button>
        </div>
    </div>
    `;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = crux;

    cancelButton = wrapper.querySelector(".cancel-icon");
    cancelButton.addEventListener("click", ()=>{ wrapper.remove() });

    const emailsContainer = wrapper.querySelector("#selected-emails");
    const emails = getSelectedEmails();
    for(let email of emails) {
        const ticket = createEmailTicket(email);
        emailsContainer.appendChild(ticket);
    }
    
    submitButton = wrapper.querySelector("#hugalugi-submit");
    submitButton.addEventListener("click", function() {
        const payload = {
            event: "block_emails",
            emails: Array.from(wrapper.querySelectorAll(".email-addr")).map((ref)=> ref.innerHTML),
            domain: wrapper.querySelector('#hugalugi-applyToAll').checked,
            action: wrapper.querySelector('input[name="filter"]:checked').value
        };

        console.log("Payload is: ", payload);
        invokeAPI(payload);
        wrapper.remove();
    });

    document.body.appendChild(wrapper);
    return wrapper;
}

const createEmailTicket = function(email) {
    const colors = ["#F4DBA6", "#F4C9A4", "#F4E6A8"];    // Ocour, skin, lemon

    const crux = `
    <style>
        .ticket {
            background-color: light-gray;
            width: auto;
            display: inline;
            border-radius: 100px;
            padding: 0rem 1rem;
            font-size: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 1rem;
        }

        .ticket span{
            display: inline-block;
        }

        .ticket-cancel-icon{
            cursor: pointer;
            font-size: 1.5rem !important;
        }

        .ticket-cancel-icon:hover{
            color: black;
            scale: 120%;
        }
    </style>

    <div class="ticket">
        <span class="email-addr">${email}</span>
        <span class="ticket-cancel-icon"> &times; </span>
    </div>
    `;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = crux;

    const idx = Math.floor(Math.random() * colors.length);
    const ticket = wrapper.querySelector(".ticket");
    ticket.style.backgroundColor = colors[idx];

    const cancelButton = wrapper.querySelector(".ticket-cancel-icon");
    cancelButton.addEventListener("click", ()=>{ wrapper.remove() });

    return wrapper;
}

function getSelectedEmails() {
    const isEmailWrapperSelected = function (emailWrapper) {
        const state = emailWrapper.children[1].children[0].getAttribute('aria-checked');
        return state == "true";
    }

    const extractEmail = function (emailWrapper) {
        const email = emailWrapper.children[3].children[1].children[0].children[0].getAttribute('email');
        return email;
    }

    const emailWrapperCollection = Array.from(document.body.children[22].children[2].children[0].children[1].children[1].children[0].children[0].children[0].children[1].children[0].children[0].children[0].children[0].children[7].children[0].children[0].children[1].children[0].children[0].children[1].children);

    const selectedEmailWrapperCollection = emailWrapperCollection.filter(isEmailWrapperSelected);
    const selectedEmailCollection = selectedEmailWrapperCollection.map(extractEmail);

    return selectedEmailCollection;
}

function unselectSelectedEmails() {
    console.log("dfghjknrsu");
    const isEmailWrapperSelected = function (emailWrapper) {
        const state = emailWrapper.children[1].children[0].getAttribute('aria-checked');
        return state == "true";
    }

    const unselectEmailWrapper = function (emailWrapper) {
        emailWrapper.children[1].children[0].setAttribute('aria-checked', 'false');
        console.log(emailWrapper.children[1].children[0]);
    }

    const emailWrapperCollection = Array.from(document.body.children[22].children[2].children[0].children[1].children[1].children[0].children[0].children[0].children[1].children[0].children[0].children[0].children[0].children[7].children[0].children[0].children[1].children[0].children[0].children[1].children);

    const selectedEmailWrapperCollection = emailWrapperCollection.filter(isEmailWrapperSelected);
    for (emailWrapper of selectedEmailWrapperCollection) {
        unselectEmailWrapper(emailWrapper);
    }
}


function createExtensionInterface() {
    const crux = `
    <style>
        #hugalugi {
            background: transparent;
            color: #5F6368;
            font-size: 12px;
            font-weight: bold;
            border: none;
            border-radius: 50%;
            height: 40px;
            width: 40px;
            cursor: pointer;
            transition: background 0.2s, transform 0.2s;
            z-index: 9999;
            transform: translateY(-10px);
        }
        
        #hugalugi:hover {
            background: #F2F2F2;
        }
        
        .icon {
            width: 16px;
            height: 16px;
        }
    </style>

    <button id="hugalugi">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-mail-warning">
            <path d="M22 10.5V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h12.5"></path>
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
            <path d="M20 14v4"></path>
            <path d="M20 22v.01"></path>
        </svg>
    </button>
    `;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = crux;

    const btn = wrapper.querySelector("#hugalugi");
    btn.addEventListener("click",createExtensionModal);

    return wrapper;
}

const Toast = {
    createAlertToast: function (message = "This is custom alert implementation.") {
        const crux = `
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Roboto&display=swap');

            .toast {
                position: fixed;
                top: 3rem;
                right: 3rem;
                background-color: #202124;
                color: white;
                padding: 0.5rem 1.5rem;
                padding-right: 1rem;
                border-radius: 5px;
                display: flex;
                align-items: center;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
                z-index: 1000;
            }
            
            .toast span {
                margin-right: 15px;
                font-family: "Roboto";
                font-size: 14px;
            }
            
            .toast-btn {
                background: transparent;
                border: none;
                color: #aacbff; /* Blue color for buttons */
                cursor: pointer;
                border-radius: 4px;
                margin-left: 10px;
                margin-top: 0px;
                padding: 10px;
                transition: 200ms;
            }
    
            .toast-btn:hover{
                background-color: #363E4F;
            }
    
            .toast::after {
                content: "";
                position: absolute;
                bottom: 0;
                left: 0;
                width: 0;
                height: 3px;
                background-color: #7597CE;
                animation: progress 2s linear forwards;
            }
            
            @keyframes progress {
                from {
                    width: 0;
                }
                to {
                    width: 100%;
                }
            }
        </style>
    
        <div class="toast">
            <span>${message}</span>
            <button class="toast-btn ok">OK</button>
        </div>
        `;

        const wrapper = document.createElement("div");
        wrapper.innerHTML = crux;
        document.body.appendChild(wrapper);

        setTimeout(() => {
            wrapper.remove();
        }, 2150);
    },
    createConfirmationToast: function (message = "This is custom implementation of undo toast") {
        const prom = new Promise((resolve, reject) => {
            const crux = `
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Roboto&display=swap');

                .toast {
                    position: fixed;
                    bottom: 1.5rem;
                    left: 1.5rem;
                    background-color: #202124;
                    color: white;
                    padding: 0.5rem 1.5rem;
                    padding-right: 1rem;
                    border-radius: 5px;
                    display: flex;
                    align-items: center;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
                    z-index: 1000;
                }
                
                .toast span {
                    margin-right: 15px;
                    font-family: "Roboto";
                    font-size: 14px;
                }
                
                .toast-btn {
                    background: transparent;
                    border: none;
                    color: #8AB4F8;
                    font-weight: bolder;
                    cursor: pointer;
                    border-radius: 4px;
                    margin-left: 10px;
                    margin-top: 0px;
                    padding: 10px;
                    transition: 200ms;
                }
        
                .toast-btn:hover{
                    background-color: #363E4F;
                }
        
                .toast::after {
                    content: "";
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    width: 0;
                    height: 3px;
                    background-color: #8AB4F8;
                    animation: progress 3s linear forwards;
                }
                
                @keyframes progress {
                    from {
                        width: 0;
                    }
                    to {
                        width: 100%;
                    }
                }
            </style>
        
            <div class="toast">
                <span>${message}</span>
                <button id="cancel" class="toast-btn">UNDO</button>
            </div>
            `;

            const wrapper = document.createElement("div");
            wrapper.innerHTML = crux;

            document.body.appendChild(wrapper);

            let approval = true;

            const id = setTimeout(() => {
                wrapper.remove();
                return resolve(approval);
            }, 3150);

            const cancelButton = wrapper.querySelector("#cancel");
            cancelButton.addEventListener('click', () => {
                approval = false;

                clearTimeout(id);
                wrapper.remove();

                return resolve(approval);
            });
        });

        return prom;
    },
    createLoadingToast: function (message = "LOADING...", decay=false) {
        const crux = `
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Roboto&display=swap');

            .toast {
                position: fixed;
                top: 3rem;
                right: 3rem;
                background-color: #202124;
                color: white;
                padding: 0.5rem 1.5rem;
                padding-right: 1rem;
                border-radius: 5px;
                display: flex;
                align-items: center;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
                z-index: 1000;
            }
            
            .toast span {
                margin-right: 15px;
                font-family: "Roboto";
                font-size: 14px;
            }
    
            .loader {
                border: 2px solid #f3f3f3;
                border-top: 2px solid #202124;
                border-radius: 50%;
                width: 1rem;
                height: 1rem;
                animation: spin 2s linear infinite;
                margin-left: 3rem;
              }              
          
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    
        <div class="toast">
            <span>${message}</span>
            <div class="loader"></div>
        </div>
        `;

        const wrapper = document.createElement("div");
        wrapper.innerHTML = crux;
        document.body.appendChild(wrapper);
        
        if(decay){
            setTimeout(() => { wrapper.remove(); }, 2150);
        }
        else
            return wrapper;
    },
}