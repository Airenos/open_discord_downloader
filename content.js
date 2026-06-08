// Content script runs in the isolated world of the webpage
console.log("[Discord Emoji Downloader] Content script injected.");

// Inject a script into the main world to access webpack and localStorage safely
const script = document.createElement("script");
script.src = chrome.runtime.getURL("inject.js");
(document.head || document.documentElement).appendChild(script);

// Listen for messages from the injected script
let discordToken = null;
window.addEventListener("message", (event) => {
    // We only accept messages from ourselves
    if (event.source !== window) return;
    
    if (event.data && event.data.type === "DISCORD_TOKEN_RESULT") {
        if (event.data.data.success) {
            discordToken = event.data.data.token;
            console.log("[Discord Emoji Downloader] Token successfully retrieved.");
        } else {
            console.warn("[Discord Emoji Downloader] Failed to retrieve token.");
        }
    }
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getToken") {
        if (discordToken) {
            sendResponse({ success: true, token: discordToken });
        } else {
            sendResponse({ error: "Token not found. Please log in to Discord." });
        }
    }
    return true; // Keep the message channel open for async response
});
