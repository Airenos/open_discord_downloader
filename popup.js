const UI = {
    viewMain: document.getElementById('view-main'),
    viewRedirect: document.getElementById('view-redirect'),
    btnOpenDiscord: document.getElementById('btn-open-discord'),
    statusContainer: document.getElementById('status-container'),
    statusText: document.getElementById('status-text'),
    serverSelect: document.getElementById('server-select'),
    contentArea: document.getElementById('content-area'),
    gridEmojis: document.getElementById('grid-emojis'),
    gridStickers: document.getElementById('grid-stickers'),
    countEmojis: document.getElementById('count-emojis'),
    countStickers: document.getElementById('count-stickers'),
    btnAllEmojis: document.getElementById('btn-all-emojis'),
    btnNoEmojis: document.getElementById('btn-no-emojis'),
    btnAllStickers: document.getElementById('btn-all-stickers'),
    btnNoStickers: document.getElementById('btn-no-stickers'),
    btnDownload: document.getElementById('btn-download'),
    downloadCount: document.getElementById('download-count'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingText: document.getElementById('loading-text')
};

let userToken = null;
let currentEmojis = [];
let currentStickers = [];

const API_HOST = "https://discord.com/api/v10";

// API Helpers
const api = {
    async request(endpoint) {
        const res = await fetch(`${API_HOST}${endpoint}`, {
            headers: { Authorization: userToken }
        });
        if (!res.ok) throw new Error(`API Error: ${res.status}`);
        return res.json();
    },
    getEmojiUrl: (id, animated) => `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}?v=1`,
    getStickerUrl: (id) => `https://media.discordapp.net/stickers/${id}.png?size=1024`
};

// State Management
function setStatus(text, state = "connecting") {
    UI.statusText.textContent = text;
    UI.statusContainer.className = `status ${state}`;
}

function showLoading(text) {
    UI.loadingText.textContent = text;
    UI.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    UI.loadingOverlay.classList.add('hidden');
}

// UI Interaction
function updateSelectionCounts() {
    const selectedEmojis = UI.gridEmojis.querySelectorAll('.grid-item.selected').length;
    const totalEmojis = currentEmojis.length;
    UI.countEmojis.textContent = `${selectedEmojis}/${totalEmojis}`;

    const selectedStickers = UI.gridStickers.querySelectorAll('.grid-item.selected').length;
    const totalStickers = currentStickers.length;
    UI.countStickers.textContent = `${selectedStickers}/${totalStickers}`;

    const totalSelected = selectedEmojis + selectedStickers;
    UI.downloadCount.textContent = totalSelected;
    UI.btnDownload.disabled = totalSelected === 0;
    
    if(totalSelected === 0) {
        UI.btnDownload.style.opacity = '0.5';
        UI.btnDownload.style.cursor = 'not-allowed';
    } else {
        UI.btnDownload.style.opacity = '1';
        UI.btnDownload.style.cursor = 'pointer';
    }
}

function renderGrid(container, items, type) {
    container.innerHTML = '';
    items.forEach(item => {
        const el = document.createElement('div');
        el.className = 'grid-item selected'; // Default to selected
        el.dataset.id = item.id;
        
        const img = document.createElement('img');
        img.src = type === 'emoji' ? api.getEmojiUrl(item.id, item.animated) : api.getStickerUrl(item.id);
        img.title = item.name;
        
        el.appendChild(img);
        el.addEventListener('click', () => {
            el.classList.toggle('selected');
            updateSelectionCounts();
        });
        container.appendChild(el);
    });
}

// Data Fetching
async function loadServerData(guildId) {
    if (!guildId) return;
    try {
        showLoading("Loading emojis & stickers...");
        UI.contentArea.classList.add('hidden');
        
        const guildData = await api.request(`/guilds/${guildId}`);
        
        // Handle names that are identical by appending a counter
        const deduplicate = (items) => {
            if (!items) return [];
            const counts = {};
            return items.map(item => {
                const count = counts[item.name] || 0;
                counts[item.name] = count + 1;
                return count > 0 ? { ...item, name: `${item.name}~${count}` } : item;
            });
        };

        currentEmojis = deduplicate(guildData.emojis || []);
        currentStickers = deduplicate(guildData.stickers || []);

        renderGrid(UI.gridEmojis, currentEmojis, 'emoji');
        renderGrid(UI.gridStickers, currentStickers, 'sticker');
        
        UI.contentArea.classList.remove('hidden');
        updateSelectionCounts();
        hideLoading();
    } catch (err) {
        console.error(err);
        setStatus("Failed to load server data", "error");
        hideLoading();
    }
}

async function initializeApp() {
    try {
        setStatus("Fetching server list...");
        const guilds = await api.request("/users/@me/guilds");
        
        // Sort guilds alphabetically
        guilds.sort((a, b) => a.name.localeCompare(b.name));
        
        UI.serverSelect.innerHTML = '<option value="">-- Choose a Server --</option>';
        guilds.forEach(guild => {
            const opt = document.createElement('option');
            opt.value = guild.id;
            opt.textContent = guild.name;
            UI.serverSelect.appendChild(opt);
        });
        
        UI.serverSelect.disabled = false;
        setStatus("Connected to Discord", "success");
        
    } catch (err) {
        console.error(err);
        setStatus("Invalid token or connection error", "error");
    }
}

// Download Logic
async function downloadSelected() {
    try {
        const selectedEmojiIds = Array.from(UI.gridEmojis.querySelectorAll('.grid-item.selected')).map(el => el.dataset.id);
        const selectedStickerIds = Array.from(UI.gridStickers.querySelectorAll('.grid-item.selected')).map(el => el.dataset.id);
        
        if (selectedEmojiIds.length === 0 && selectedStickerIds.length === 0) return;

        showLoading("Downloading files...");
        const zip = new JSZip();
        const emojiFolder = zip.folder("Emojis");
        const stickerFolder = zip.folder("Stickers");

        const emojisToDownload = currentEmojis.filter(e => selectedEmojiIds.includes(e.id));
        const stickersToDownload = currentStickers.filter(s => selectedStickerIds.includes(s.id));

        // Download Emojis
        for (const emoji of emojisToDownload) {
            try {
                let url = api.getEmojiUrl(emoji.id, emoji.animated);
                let res = await fetch(url);
                if (!res.ok) res = await fetch(`https://corsproxy.io/?${url}`); // Fallback
                const blob = await res.blob();
                emojiFolder.file(`${emoji.name}.${emoji.animated ? 'gif' : 'png'}`, blob);
            } catch (e) { console.error(`Failed emoji: ${emoji.name}`, e); }
        }

        // Download Stickers
        for (const sticker of stickersToDownload) {
            try {
                let url = api.getStickerUrl(sticker.id);
                let res = await fetch(url);
                if (!res.ok) res = await fetch(`https://corsproxy.io/?${url}`); // Fallback
                const blob = await res.blob();
                stickerFolder.file(`${sticker.name}.png`, blob);
            } catch (e) { console.error(`Failed sticker: ${sticker.name}`, e); }
        }

        showLoading("Creating ZIP file...");
        const content = await zip.generateAsync({ type: "blob" });
        
        const serverName = UI.serverSelect.options[UI.serverSelect.selectedIndex].text.replace(/[^a-zA-Z0-9]/g, '_');
        const url = URL.createObjectURL(content);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${serverName}_Assets.zip`;
        a.click();
        URL.revokeObjectURL(url);

        hideLoading();
    } catch (err) {
        console.error(err);
        alert("An error occurred during download.");
        hideLoading();
    }
}

// Event Listeners
UI.serverSelect.addEventListener('change', (e) => loadServerData(e.target.value));
UI.btnDownload.addEventListener('click', downloadSelected);

UI.btnOpenDiscord.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: "openDiscord" });
    window.close();
});

const setAllSelected = (container, state) => {
    container.querySelectorAll('.grid-item').forEach(el => el.classList.toggle('selected', state));
    updateSelectionCounts();
};
UI.btnAllEmojis.addEventListener('click', () => setAllSelected(UI.gridEmojis, true));
UI.btnNoEmojis.addEventListener('click', () => setAllSelected(UI.gridEmojis, false));
UI.btnAllStickers.addEventListener('click', () => setAllSelected(UI.gridStickers, true));
UI.btnNoStickers.addEventListener('click', () => setAllSelected(UI.gridStickers, false));

// Initialization
document.addEventListener("DOMContentLoaded", async () => {
    // Check if we are on a valid discord page to get token
    const isDiscordReady = await new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (tab && tab.url && tab.url.includes("discord.com")) {
                resolve(true);
            } else {
                resolve(false);
            }
        });
    });

    if (!isDiscordReady) {
        UI.viewMain.classList.add('hidden');
        UI.viewRedirect.classList.remove('hidden');
        return;
    }

    // Try to get token from content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { action: "getToken" }, (response) => {
            if (chrome.runtime.lastError || !response || !response.success) {
                setStatus("Failed to connect. Refresh Discord page.", "error");
                return;
            }
            userToken = response.token;
            initializeApp();
        });
    });
});
