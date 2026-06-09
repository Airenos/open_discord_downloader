// ==UserScript==
// @name         Discord Emoji & Sticker Downloader
// @namespace    https://github.com/
// @version      1.0.8
// @description  Batch download custom emojis and stickers from Discord servers.
// @author       Airenos (https://github.com/Airenos)
// @license      MIT
// @match        https://discord.com/*
// @icon         https://raw.githubusercontent.com/Airenos/open_discord_downloader/main/icons/logo128.png
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/2.6.1/jszip.min.js
// @grant        GM_xmlhttpRequest
// @connect      discord.com
// @connect      cdn.discordapp.com
// @connect      media.discordapp.net
// @updateURL    https://raw.githubusercontent.com/Airenos/open_discord_downloader/main/discord-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/Airenos/open_discord_downloader/main/discord-downloader.user.js
// @homepageURL  https://github.com/Airenos/open_discord_downloader
// @supportURL   https://github.com/Airenos/open_discord_downloader/issues
// ==/UserScript==

(function() {
    'use strict';

    const API_HOST = "https://discord.com/api/v10";
    let userToken = null;
    let currentEmojis = [];
    let currentStickers = [];

    // --- Token Extraction (Safe against Sandbox and Discord's Webpack hooks) ---
    function extractToken() {
        try {
            // Discord overrides the global localStorage to hide the 'token' key.
            // We bypass this by creating a fresh iframe and using its pristine localStorage object.
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            document.body.appendChild(iframe);
            const token = iframe.contentWindow.localStorage.getItem('token');
            document.body.removeChild(iframe);
            
            if (token) {
                return token.replace(/^"|"$/g, "");
            }
        } catch(e) { 
            console.error("Iframe token extraction error:", e); 
        }
        return null;
    }

    // --- API & Utilities ---
    function fetchApi(endpoint) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: `${API_HOST}${endpoint}`,
                headers: {
                    "Authorization": userToken,
                    "Content-Type": "application/json"
                },
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) {
                        try {
                            resolve(JSON.parse(res.responseText));
                        } catch(e) { reject(new Error("Invalid JSON parsed")); }
                    } else {
                        reject(new Error(`HTTP ${res.status}`));
                    }
                },
                onerror: () => reject(new Error("Network Error"))
            });
        });
    }

    // Try native fetch first (for instant browser cache hits), fallback to GM_xmlhttpRequest
    async function downloadImage(url) {
        try {
            const res = await fetch(url, { cache: "force-cache" });
            if (res.ok) return await res.arrayBuffer();
        } catch (e) {
            // Fetch failed (likely CORS or opaque response), falling back
        }

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                responseType: "arraybuffer",
                onload: (res) => {
                    if (res.status === 200) resolve(res.response);
                    else reject(new Error("Failed to download image"));
                },
                onerror: reject
            });
        });
    }

    const getEmojiUrl = (id, animated) => `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}?v=1`;
    const getStickerUrl = (id) => `https://media.discordapp.net/stickers/${id}.png?size=1024`;

    // --- UI Creation (Using Shadow DOM to avoid CSS conflicts) ---
    function injectUI() {
        if (document.getElementById('discord-downloader-root')) return;

        const host = document.createElement('div');
        host.id = 'discord-downloader-root';
        host.style.position = 'fixed';
        host.style.bottom = '20px';
        host.style.right = '20px';
        host.style.zIndex = '999999';
        document.body.appendChild(host);

        const shadow = host.attachShadow({mode: 'open'});

        const style = document.createElement('style');
        style.textContent = `
            :host {
                --blurple: #5865F2; --blurple-hover: #4752C4;
                --bg-main: #313338; --bg-sec: #2B2D31; --bg-tert: #1E1F22;
                --text: #DBDEE1; --text-muted: #949BA4;
            }
            .floating-btn {
                background: var(--blurple); color: white; border: none;
                padding: 12px 20px; border-radius: 20px; font-weight: bold;
                cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.3);
                transition: transform 0.2s, background 0.2s;
                display: flex; align-items: center; gap: 8px; font-family: sans-serif;
            }
            .floating-btn:hover { background: var(--blurple-hover); transform: translateY(-2px); }
            
            .modal-overlay {
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center;
                opacity: 0; pointer-events: none; transition: opacity 0.2s;
            }
            .modal-overlay.open { opacity: 1; pointer-events: all; }
            
            .modal {
                background: var(--bg-main); width: 450px; max-height: 80vh;
                border-radius: 8px; display: flex; flex-direction: column;
                color: var(--text); font-family: sans-serif; box-shadow: 0 10px 25px rgba(0,0,0,0.5);
                overflow: hidden;
            }
            .modal-header { padding: 16px; border-bottom: 1px solid var(--bg-tert); display: flex; justify-content: space-between; align-items: center;}
            .modal-header h2 { margin: 0; font-size: 16px; color: white;}
            .close-btn { background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer; }
            .close-btn:hover { color: white; }
            
            .modal-body { padding: 16px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 16px;}
            
            select { background: var(--bg-tert); color: var(--text); padding: 10px; border: 1px solid var(--bg-tert); border-radius: 4px; width: 100%; outline: none; cursor: pointer;}
            select option { background: var(--bg-sec); color: var(--text); }
            
            .grid-title { display: flex; justify-content: space-between; font-size: 12px; font-weight: bold; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px;}
            .grid-actions button { background: var(--bg-sec); color: var(--text); border: none; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;}
            .grid-actions button:hover { background: var(--blurple); color: white; }
            
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(50px, 1fr)); gap: 8px; background: var(--bg-sec); padding: 8px; border-radius: 8px; max-height: 200px; overflow-y: auto;}
            .grid-item { aspect-ratio: 1; background: var(--bg-tert); border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; position: relative; border: 2px solid transparent;}
            .grid-item img { width: 75%; height: 75%; object-fit: contain;}
            .grid-item.selected { border-color: var(--blurple); background: rgba(88, 101, 242, 0.2); }
            .grid-item.selected::after { content: '✓'; position: absolute; top: -5px; right: -5px; background: var(--blurple); color: white; width: 14px; height: 14px; font-size: 10px; border-radius: 50%; display: flex; align-items: center; justify-content: center;}
            
            .modal-footer { padding: 16px; border-top: 1px solid var(--bg-tert); }
            .download-btn { width: 100%; background: var(--blurple); color: white; border: none; padding: 12px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 14px; transition: 0.2s;}
            .download-btn:hover { background: var(--blurple-hover); }
            .download-btn:disabled { opacity: 0.5; cursor: not-allowed; }

            /* Scrollbar */
            ::-webkit-scrollbar { width: 8px; }
            ::-webkit-scrollbar-track { background: var(--bg-tert); }
            ::-webkit-scrollbar-thumb { background: #1A1B1E; border-radius: 4px;}
        `;
        shadow.appendChild(style);

        // UI Structure
        const container = document.createElement('div');
        container.innerHTML = `
            <button class="floating-btn">📥 Emojis</button>
            <div class="modal-overlay">
                <div class="modal">
                    <div class="modal-header">
                        <h2>Discord Emoji Downloader</h2>
                        <button class="close-btn">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div>
                            <select id="server-select"><option>Loading servers...</option></select>
                        </div>
                        <div id="content-area" style="display: none;">
                            <div class="grid-title">
                                <span>Emojis (<span id="emoji-count">0/0</span>)</span>
                                <div class="grid-actions"><button id="em-all">All</button> <button id="em-none">None</button></div>
                            </div>
                            <div class="grid" id="emoji-grid"></div>

                            <div class="grid-title" style="margin-top: 16px;">
                                <span>Stickers (<span id="sticker-count">0/0</span>)</span>
                                <div class="grid-actions"><button id="st-all">All</button> <button id="st-none">None</button></div>
                            </div>
                            <div class="grid" id="sticker-grid"></div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="download-btn" id="dl-btn" disabled>Download 0 Items</button>
                    </div>
                </div>
            </div>
        `;
        shadow.appendChild(container);

        // Selectors
        const btnOpen = shadow.querySelector('.floating-btn');
        const overlay = shadow.querySelector('.modal-overlay');
        const btnClose = shadow.querySelector('.close-btn');
        const select = shadow.querySelector('#server-select');
        const contentArea = shadow.querySelector('#content-area');
        const emGrid = shadow.querySelector('#emoji-grid');
        const stGrid = shadow.querySelector('#sticker-grid');
        const dlBtn = shadow.querySelector('#dl-btn');

        // Drag Logic
        let isDragging = false;
        btnOpen.addEventListener('mousedown', (e) => {
            isDragging = false;
            const startX = e.clientX, startY = e.clientY;
            const rect = host.getBoundingClientRect();
            
            // Switch from right/bottom to left/top for predictable dragging
            host.style.right = 'auto';
            host.style.bottom = 'auto';
            host.style.left = rect.left + 'px';
            host.style.top = rect.top + 'px';

            const onMouseMove = (moveEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging = true;
                if (isDragging) {
                    host.style.left = (rect.left + dx) + 'px';
                    host.style.top = (rect.top + dy) + 'px';
                }
            };
            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        // Logic
        btnOpen.onclick = async (e) => {
            if (isDragging) {
                e.preventDefault();
                return;
            }
            overlay.classList.add('open');
            if (select.options.length <= 1) {
                select.innerHTML = '<option>Step 1: Extracting Token...</option>';
                // Give the browser a tiny moment to render the text
                await new Promise(resolve => setTimeout(resolve, 50));

                userToken = extractToken();
                if (!userToken) {
                    select.innerHTML = '<option>Error: Token not found! Try refreshing.</option>';
                    return;
                }
                
                select.innerHTML = '<option>Step 2: Fetching Servers...</option>';
                try {
                    const guilds = await fetchApi("/users/@me/guilds");
                    guilds.sort((a, b) => a.name.localeCompare(b.name));
                    select.innerHTML = '<option value="">-- Choose a Server --</option>';
                    guilds.forEach(g => {
                        const opt = document.createElement('option');
                        opt.value = g.id; opt.textContent = g.name;
                        select.appendChild(opt);
                    });
                } catch(e) { select.innerHTML = `<option>API Error: ${e.message}</option>`; }
            }
        };

        btnClose.onclick = () => overlay.classList.remove('open');
        overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('open'); };

        const updateCounts = () => {
            const emSel = emGrid.querySelectorAll('.selected').length;
            const stSel = stGrid.querySelectorAll('.selected').length;
            shadow.querySelector('#emoji-count').textContent = `${emSel}/${currentEmojis.length}`;
            shadow.querySelector('#sticker-count').textContent = `${stSel}/${currentStickers.length}`;
            const total = emSel + stSel;
            dlBtn.textContent = `Download ${total} Items`;
            dlBtn.disabled = total === 0;
        };

        const renderItems = (grid, items, type) => {
            grid.innerHTML = '';
            items.forEach(item => {
                const div = document.createElement('div');
                div.className = 'grid-item selected';
                div.dataset.id = item.id;
                div.innerHTML = `<img src="${type === 'emoji' ? getEmojiUrl(item.id, item.animated) : getStickerUrl(item.id)}" title="${item.name}">`;
                div.onclick = () => { div.classList.toggle('selected'); updateCounts(); };
                grid.appendChild(div);
            });
        };

        select.onchange = async () => {
            const guildId = select.value;
            if(!guildId) { contentArea.style.display = 'none'; return; }
            contentArea.style.display = 'block';
            select.disabled = true;
            try {
                const data = await fetchApi(`/guilds/${guildId}`);
                // Deduplicate names
                const dedup = (arr) => {
                    const counts = {};
                    return (arr||[]).map(x => {
                        const c = counts[x.name] || 0; counts[x.name] = c + 1;
                        return c > 0 ? {...x, name: `${x.name}~${c}`} : x;
                    });
                };
                currentEmojis = dedup(data.emojis);
                currentStickers = dedup(data.stickers);
                renderItems(emGrid, currentEmojis, 'emoji');
                renderItems(stGrid, currentStickers, 'sticker');
                updateCounts();
            } catch (e) { alert("Error loading emojis"); }
            select.disabled = false;
        };

        const setAll = (grid, state) => {
            grid.querySelectorAll('.grid-item').forEach(el => el.classList.toggle('selected', state));
            updateCounts();
        };
        shadow.querySelector('#em-all').onclick = () => setAll(emGrid, true);
        shadow.querySelector('#em-none').onclick = () => setAll(emGrid, false);
        shadow.querySelector('#st-all').onclick = () => setAll(stGrid, true);
        shadow.querySelector('#st-none').onclick = () => setAll(stGrid, false);

        dlBtn.onclick = async () => {
            dlBtn.disabled = true;
            dlBtn.textContent = "Downloading... Please wait";
            
            try {
                const zip = new JSZip();
                const emFolder = zip.folder("Emojis");
                const stFolder = zip.folder("Stickers");

                const emSel = Array.from(emGrid.querySelectorAll('.selected')).map(el=>el.dataset.id);
                const stSel = Array.from(stGrid.querySelectorAll('.selected')).map(el=>el.dataset.id);

                // Fetch all images concurrently for lightning-fast speeds
                const emPromises = currentEmojis.filter(x => emSel.includes(x.id)).map(async em => {
                    try {
                        const buffer = await downloadImage(getEmojiUrl(em.id, em.animated));
                        emFolder.file(`${em.name}.${em.animated?'gif':'png'}`, new Uint8Array(buffer));
                    } catch(e) {}
                });
                
                const stPromises = currentStickers.filter(x => stSel.includes(x.id)).map(async st => {
                    try {
                        const buffer = await downloadImage(getStickerUrl(st.id));
                        stFolder.file(`${st.name}.png`, new Uint8Array(buffer));
                    } catch(e) {}
                });

                await Promise.all([...emPromises, ...stPromises]);

                dlBtn.textContent = "Zipping...";
                
                // Allow UI to update before synchronous zip blocks the thread
                await new Promise(r => setTimeout(r, 50));
                
                const uint8 = zip.generate({type:"uint8array"});
                const content = new Blob([uint8], { type: "application/zip" });
                // Replace only invalid Windows filename characters, preserving Chinese
                const serverName = select.options[select.selectedIndex].text.replace(/[\\/:*?"<>|]/g, '_');
                
                const url = URL.createObjectURL(content);
                const a = document.createElement("a");
                a.href = url; a.download = `${serverName}_Assets.zip`;
                a.click(); URL.revokeObjectURL(url);
                
                dlBtn.textContent = "Success!";
                setTimeout(() => updateCounts(), 2000);
            } catch(e) {
                alert("Download failed: " + e.message);
                updateCounts();
            }
        };
    }

    // Try to inject UI periodically until document body exists
    const initInterval = setInterval(() => {
        if (document.body) {
            clearInterval(initInterval);
            injectUI();
        }
    }, 1000);

})();
