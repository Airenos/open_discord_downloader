// Background Service Worker
chrome.runtime.onInstalled.addListener(() => {
    console.log("Discord Emoji & Sticker Downloader Installed!");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "openDiscord") {
        chrome.tabs.create({ url: "https://discord.com/channels/@me" });
    }
});

chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.url || !tab.url.includes("discord.com")) {
        chrome.tabs.update(tab.id, { url: "https://discord.com/channels/@me" });
    }
});
